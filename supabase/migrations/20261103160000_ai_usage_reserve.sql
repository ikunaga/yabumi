-- 文章の AI（Claude）の上限を「先に予約」にする（セキュリティ確認 2026-11-03 の M2・M1。docs/architecture.md の 4.9）。
-- これまでは ai_usage を数えて判定してから呼び、返事のあとに記録していたので、同じ人が同時にたくさん送ると全部が判定を通り、
-- 本人と全体の上限を超えられた。AI の画像（reserve_ai_images）と同じく、1 本のロックの中で合計を確かめ、見込みの費用で行を作ってから呼ぶ。
-- 返事のあとでアプリ（src/lib/ai/budget.ts の withAiBudget）が実際の額に直し（status = 'done'）、呼び出しに失敗したら行を消す。
-- 予約のまま残った行（途中で落ちたなど）は、見込みの額のまま数える（費用がかかったかわからないので、上限を超えない側に倒す。13 か月で消える）。
-- 断った分は行を作らない（全体の枠に数えない）。
--
-- 上限はここで固定する（呼び出し側から渡さない。前は環境変数 AI_USER_MONTHLY_BUDGET_USD などで変えられた）:
--   本人: 月 $3、1 日 60 回。yabumi 全体: 月 $10
--   新しい人（登録して 7 日まで。auth.users.created_at で判定。オーナーの決定「新しい人は少なめ」）: 本人の月の上限は 3 分の 1（$1）、
--   登録 7 日以内の人たち全体で使えるのは全体の月の枠の 3 分の 1（$3.33）まで。新しい人たちの分は、今月の行のうち、新しい人のときに予約した行
--   （by_new_user）で数える（いま新しい人の行で数えると、8 日目になった人・退会した人の分が外れて枠が空き直し、アカウントを作っては使い切れるため）。
--   新しい人が予約するときだけ確かめる。AI の画像（ai_image_quota・reserve_ai_images、実装担当2）と同じ数え方
-- p_as_of は結合テストだけが使う（登録からの日数を数える時点。月と日の区切りはいつも now()。service_role だけが呼べる関数なのでアプリからは渡さない）
-- 月と日の区切りは日本時間。p_scope_owner を入れると、全体の合計をその利用者と予約する本人の分だけで数える（結合テストで、同じ DB のほかのテストに左右されないため）

alter table public.ai_usage add column status text not null default 'done' check (status in ('reserved', 'done'));
-- 新しい人（登録して 7 日まで）が予約した行の印。新しい人たちの枠はこの印の行で数える（退会すると owner_id が空になって auth.users と結べなくなり、
-- 登録 → 使う → 退会を繰り返すと枠が空き直すため。行は退会しても 13 か月残る。AI の画像の ai_image_jobs.by_new_user と同じ）
alter table public.ai_usage add column by_new_user boolean not null default false;
comment on column public.ai_usage.status is 'reserved: 呼ぶ前に見込みの費用で予約した（返事のあと done にして実際の額に直す。失敗したら消す）';

create function public.reserve_ai_usage(
  p_owner_id uuid,
  p_purpose text,
  p_cost_usd numeric,
  p_thread_id uuid default null,
  p_scope_owner uuid default null,
  p_as_of timestamptz default null
)
returns table (usage_id uuid, status text, global_month_usd numeric, new_until date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_user_monthly_usd constant numeric := 3;
  c_global_monthly_usd constant numeric := 10;
  c_user_daily_turns constant integer := 60;
  c_new_days constant interval := interval '7 days';
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_day_start timestamptz := date_trunc('day', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_created timestamptz;
  v_new boolean;
  v_new_until date;
  v_global numeric;
  v_new_global numeric;
  v_user numeric;
  v_today integer;
  v_id uuid;
begin
  if p_owner_id is null or p_purpose is null or p_cost_usd is null or p_cost_usd <= 0 or p_cost_usd > 5 then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  select u.created_at into v_created from auth.users u where u.id = p_owner_id;
  if v_created is null then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  v_new := v_created + c_new_days > coalesce(p_as_of, v_now);
  v_new_until := ((v_created + c_new_days) at time zone 'Asia/Tokyo')::date;

  perform pg_advisory_xact_lock(hashtext('ai_usage'));
  select coalesce(sum(a.cost_usd), 0) into v_global
    from public.ai_usage a
   where a.created_at >= v_month_start
     and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
  select coalesce(sum(a.cost_usd) filter (where a.created_at >= v_month_start), 0),
         (count(*) filter (where a.created_at >= v_day_start))::integer
    into v_user, v_today
    from public.ai_usage a
   where a.owner_id = p_owner_id
     and a.created_at >= least(v_month_start, v_day_start);

  if v_global + p_cost_usd > c_global_monthly_usd then
    return query select null::uuid, 'global_limit'::text, v_global, null::date;
    return;
  end if;
  if v_new then
    -- 今月、新しい人のときに予約した行（退会しても残る）
    select coalesce(sum(a.cost_usd), 0) into v_new_global
      from public.ai_usage a
     where a.created_at >= v_month_start
       and a.by_new_user
       and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
    if v_new_global + p_cost_usd > c_global_monthly_usd / 3 then
      return query select null::uuid, 'new_global_limit'::text, v_global, v_new_until;
      return;
    end if;
    if v_user + p_cost_usd > c_user_monthly_usd / 3 then
      return query select null::uuid, 'new_user_limit'::text, v_global, v_new_until;
      return;
    end if;
  elsif v_user + p_cost_usd > c_user_monthly_usd then
    return query select null::uuid, 'user_limit'::text, v_global, null::date;
    return;
  end if;
  if v_today >= c_user_daily_turns then
    return query select null::uuid, 'daily_limit'::text, v_global, null::date;
    return;
  end if;

  insert into public.ai_usage (owner_id, thread_id, purpose, model, cost_usd, status, by_new_user)
  values (p_owner_id, p_thread_id, p_purpose, 'reserved', p_cost_usd, 'reserved', v_new)
  returning id into v_id;
  return query select v_id, 'ok'::text, v_global + p_cost_usd, case when v_new then v_new_until end;
end;
$$;

comment on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) is '文章の AI を呼ぶ前に、上限（関数の中で固定）を確かめて見込みの費用で予約する。断った分は記録しない';

revoke all on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) to service_role;
