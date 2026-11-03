-- AI の画像の上限を、アカウントを作り直して使い切られないようにする（docs/security/2026-11-03_セキュリティ確認.md の M1・L6。オーナーの決定「新しい人は少なめ」）。
-- ① 登録して 7 日まで（auth.users.created_at から 7 日。サーバーで決める）は、1 人 月 3 枚まで（ふだんは 20 枚）
-- ② 登録 7 日以内の人たち全体で使えるのは、全体の月の枠（$6.66）の 3 分の 1 まで。数えるのは「新しい人が予約した分」（予約のときに行に by_new_user を書く。
--    退会すると owner_id が空になるので、auth.users との join では数えない。退会して枠を空け直すことができないように）
-- ③ 試みは 1 人 1 日（日本時間）20 回まで。作れなかった回（失敗・安全の決まりで断られた）も数える
-- 上限はすべてこの関数の中で固定する（呼び出し側から渡さない）。画面に出す値は src/lib/ai/photo.ts の PHOTO_LIMITS（同じ値。テストで確かめる）。
-- 文章の AI（Claude）の同じ直しと、数え方（7 日・3 分の 1）をそろえる（実装担当1。src/lib/ai/limits.ts）

-- 当て直しに耐えるように（ローカルの共有 DB で、本番に出す前に直して当て直したため）
drop function if exists public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid);
drop function if exists public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid, timestamptz);
drop function if exists public.ai_image_quota(uuid, timestamptz, uuid);

-- 今ある行は false のまま（新しい人たちの枠に数えない）。この直しを出す月に新しい人は、運営者とテストの利用者だけのため（2026-11-03 PM の判断）。
-- 新しい人（登録して 7 日まで）が予約した行か。予約の関数だけが書く（利用者は ai_image_jobs に書けない）。退会しても残る
alter table public.ai_image_jobs add column if not exists by_new_user boolean not null default false;
comment on column public.ai_image_jobs.by_new_user is '登録して 7 日までの人が予約した行か（新しい人たちの枠を数える。退会しても残す）';

-- いまの使い方と上限（予約と画面の表示の両方が、これで数える）。
-- p_as_of: 登録からの日数を数える時点（テストで「7 日あと」を試すため。アプリからは渡さない。月と日の区切りは、いつも now()）。
-- p_scope_owner: 全体の費用をその利用者の分だけで数える（結合テストで、同じ DB のほかのテストに左右されないため。アプリからは渡さない）
create function public.ai_image_quota(p_owner_id uuid, p_as_of timestamptz default null, p_scope_owner uuid default null)
returns table (
  user_month_images integer,
  user_monthly_limit integer,
  new_until timestamptz,
  global_month_usd numeric,
  new_users_month_usd numeric,
  attempts_today integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_user_monthly_images constant integer := 20;
  c_new_user_monthly_images constant integer := 3;
  c_new_user_days constant interval := interval '7 days';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_registered timestamptz;
begin
  select u.created_at into v_registered from auth.users u where u.id = p_owner_id;
  if v_registered is null then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  return query
  select
    (select coalesce(sum(j.images), 0)::integer from public.ai_image_jobs j
      where j.owner_id = p_owner_id and j.created_at >= v_month_start and j.status <> 'failed'),
    case when v_registered + c_new_user_days > coalesce(p_as_of, now()) then c_new_user_monthly_images else c_user_monthly_images end,
    case when v_registered + c_new_user_days > coalesce(p_as_of, now()) then v_registered + c_new_user_days else null end,
    (select coalesce(sum(j.cost_usd), 0) from public.ai_image_jobs j
      where j.created_at >= v_month_start and j.status <> 'failed' and (p_scope_owner is null or j.owner_id = p_scope_owner)),
    (select coalesce(sum(j.cost_usd), 0) from public.ai_image_jobs j
      where j.created_at >= v_month_start and j.status <> 'failed' and j.by_new_user
        and (p_scope_owner is null or j.owner_id = p_scope_owner)),
    (select count(*)::integer from public.ai_image_jobs j where j.owner_id = p_owner_id and j.created_at >= v_day_start);
end;
$$;
revoke all on function public.ai_image_quota(uuid, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.ai_image_quota(uuid, timestamptz, uuid) to service_role;

-- 予約。上限を超えるなら予約せず、理由（status）を返す。全体で 1 本のロックの中で数える（同時に押されても超えない）。
-- 予約（reserved）のまま残ったもの（途中で落ちたなど）も数える（多めに数えて、上限を超えない側に倒す）
create function public.reserve_ai_images(
  p_owner_id uuid,
  p_project_id uuid,
  p_model text,
  p_images integer,
  p_cost_usd numeric,
  p_scope_owner uuid default null,
  p_as_of timestamptz default null
)
returns table (
  job_id uuid,
  status text,
  user_month_images integer,
  user_monthly_limit integer,
  new_until timestamptz,
  global_month_usd numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_global_monthly_usd constant numeric := 6.66;
  c_new_users_share constant numeric := 1.0 / 3;
  c_daily_attempts constant integer := 20;
  q record;
  v_id uuid;
begin
  if p_images < 1 or p_images > 4 or p_cost_usd is null or p_cost_usd <= 0 then
    raise exception 'images out of range' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_image_jobs'));
  select * into q from public.ai_image_quota(p_owner_id, p_as_of, p_scope_owner);
  -- 試みの回数（作れなかった回も数える）
  if q.attempts_today >= c_daily_attempts then
    return query select null::uuid, 'attempt_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  if q.global_month_usd + p_cost_usd > c_global_monthly_usd then
    return query select null::uuid, 'global_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  -- 登録 7 日以内の人たち全体の枠（全体の 3 分の 1）
  if q.new_until is not null and q.new_users_month_usd + p_cost_usd > c_global_monthly_usd * c_new_users_share then
    return query select null::uuid, 'new_users_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  if q.user_month_images + p_images > q.user_monthly_limit then
    return query select null::uuid, 'user_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  insert into public.ai_image_jobs (owner_id, project_id, model, images, cost_usd, by_new_user)
  values (p_owner_id, p_project_id, p_model, p_images, p_cost_usd, q.new_until is not null)
  returning id into v_id;
  return query select v_id, 'ok'::text, q.user_month_images + p_images, q.user_monthly_limit, q.new_until, q.global_month_usd + p_cost_usd;
end;
$$;
revoke all on function public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid, timestamptz) to service_role;
