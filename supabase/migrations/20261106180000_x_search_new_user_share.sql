-- X の人気の投稿を探す（4.52）に「新しい人たちの取り分」を足す（セキュリティ確認 2026-11-06 の M2）。
-- 前は yabumi 全体で月 $1（約 6 回）で、登録して 7 日までの人も 1 回探せたので、使い捨てのアカウントを 6 つ作れば全員の今月の分が尽きた。
-- AI の文章・画像（20261103160300・20261103170000）と同じく、登録して 7 日までの人たち全体で使えるのを、全体の枠の 3 分の 1（$1 / 3）までにする。
-- - 予約のとき、その人が新しい人かをサーバーが決めて x_search_usage.by_new_user に残す（利用者からは来ない）
-- - 新しい人たちの取り分は、その印の付いた今月の行の費用で数える。いま新しい人の行で数えると、8 日目になった人・退会した人の分が外れて
--   枠が空き直し、アカウントを作っては使い切れるため（行は退会しても紐づけを外して 13 か月残る。AI と同じ）
-- - 断るときの status は new_global_limit。次に探せる日（resets_on）は、その人が 7 日たつ日（その月の中なら）か来月 1 日

alter table public.x_search_usage add column by_new_user boolean not null default false;

comment on column public.x_search_usage.by_new_user is '予約したとき、登録して 7 日までの人だったか（サーバーが決める）。新しい人たちの取り分（全体の 3 分の 1）を数える';

-- status: ok / user_limit / new_user_limit / global_limit / new_global_limit（登録 7 日までの人たち全体の今月の取り分を使い切った）
create or replace function public.x_search_quota(p_owner_id uuid, p_scope_owner uuid default null, p_as_of timestamptz default null)
returns table (status text, used integer, limit_count integer, resets_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_user_monthly constant integer := 3;
  c_new_user_monthly constant integer := 1;
  c_new_days constant interval := interval '7 days';
  c_global_monthly_usd constant numeric := 1;
  c_cost_usd constant numeric := 0.15;
  v_now timestamptz := coalesce(p_as_of, now());
  v_month_start timestamptz := date_trunc('month', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_next_month date := (date_trunc('month', v_now at time zone 'Asia/Tokyo') + interval '1 month')::date;
  v_created timestamptz;
  v_new_until timestamptz;
  v_new boolean;
  v_limit integer;
  v_used integer;
  v_global numeric;
  v_new_global numeric;
begin
  select u.created_at into v_created from auth.users u where u.id = p_owner_id;
  if v_created is null then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  v_new_until := v_created + c_new_days;
  v_new := v_new_until > v_now;
  v_limit := case when v_new then c_new_user_monthly else c_user_monthly end;

  select count(*)::integer into v_used
    from public.x_search_usage x
   where x.owner_id = p_owner_id and x.created_at >= v_month_start;
  select coalesce(sum(x.cost_usd), 0), coalesce(sum(x.cost_usd) filter (where x.by_new_user), 0) into v_global, v_new_global
    from public.x_search_usage x
   where x.created_at >= v_month_start
     and (p_scope_owner is null or x.owner_id in (p_scope_owner, p_owner_id));

  if v_used >= v_limit then
    -- 新しい人は、7 日たてば月 3 回になる（その月の中なら、その日から）
    if v_limit = c_new_user_monthly and v_used < c_user_monthly and (v_new_until at time zone 'Asia/Tokyo')::date < v_next_month then
      return query select 'new_user_limit'::text, v_used, v_limit, (v_new_until at time zone 'Asia/Tokyo')::date;
    else
      return query select 'user_limit'::text, v_used, v_limit, v_next_month;
    end if;
  elsif v_global + c_cost_usd > c_global_monthly_usd then
    return query select 'global_limit'::text, v_used, v_limit, v_next_month;
  elsif v_new and v_new_global + c_cost_usd > c_global_monthly_usd / 3 then
    -- 7 日たてば、新しい人の取り分ではなく全体の枠で探せる（その月の中なら、その日から）
    return query select 'new_global_limit'::text, v_used, v_limit, least((v_new_until at time zone 'Asia/Tokyo')::date, v_next_month);
  else
    return query select 'ok'::text, v_used, v_limit, null::date;
  end if;
end;
$$;

revoke all on function public.x_search_quota(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.x_search_quota(uuid, uuid, timestamptz) to service_role;

-- 予約する（ロックの中で判定してから行を作る）。新しい人かどうかは、ここでサーバーが決めて行に残す
create or replace function public.reserve_x_search(p_owner_id uuid, p_project_id uuid, p_scope_owner uuid default null, p_as_of timestamptz default null)
returns table (usage_id uuid, status text, used integer, limit_count integer, resets_on date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cost_usd constant numeric := 0.15;
  c_new_days constant interval := interval '7 days';
  q record;
  v_new boolean;
  v_id uuid;
begin
  if p_owner_id is null then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  -- プロジェクトは本人のものだけ（アプリでも RLS で確かめるが、記録に他人のプロジェクトを付けない）
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id) then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('x_search_usage'));
  select * into q from public.x_search_quota(p_owner_id, p_scope_owner, p_as_of);
  if q.status <> 'ok' then
    return query select null::uuid, q.status, q.used, q.limit_count, q.resets_on;
    return;
  end if;
  select u.created_at + c_new_days > coalesce(p_as_of, now()) into v_new from auth.users u where u.id = p_owner_id;
  insert into public.x_search_usage (owner_id, project_id, cost_usd, created_at, by_new_user)
  values (p_owner_id, p_project_id, c_cost_usd, coalesce(p_as_of, now()), coalesce(v_new, false))
  returning id into v_id;
  return query select v_id, 'ok'::text, q.used + 1, q.limit_count, null::date;
end;
$$;

revoke all on function public.reserve_x_search(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_x_search(uuid, uuid, uuid, timestamptz) to service_role;
