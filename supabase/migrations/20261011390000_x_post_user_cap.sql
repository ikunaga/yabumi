-- X の投稿の、利用者ごとの月の上限（docs/architecture.md の 4.13・4.19、docs/cost-review.md の「見つけた穴」。2026-10-11）。
-- これまで X の投稿には矢書全体の月の上限（X_MONTHLY_BUDGET_USD、既定 $3）しかなく、URL つきは 1 本 $0.20 なので、
-- 1 人が 15 本送ると、その月は全員が X に自動で送れなくなった。
-- そこで reserve_sns_spend に p_user_budget_usd を足し、全体の上限と利用者ごとの上限を、同じロックの中で順に確かめる
-- （同時に送っても超えない。reserve_x_metrics_read と同じ考え方）。
--
-- 利用者ごとに数えるのは「X の投稿まわり」の費用: 投稿（post・post_with_url）、投稿がまだあるかの確認（post_read）、
-- つなぐときの読み取り（user_read）。X の数字（metrics_read・followers_read）は別の上限（X_METRICS_USER_MONTHLY_USD）で数える。
--
-- 引数の関係:
-- - p_budget_usd: 矢書全体の上限。null なら確かめない
-- - p_scope_owner: 全体の上限を数える範囲。null なら矢書全体（本番）。値を入れると、その利用者の記録だけを数える（テスト用）
-- - p_user_budget_usd: 利用者ごとの上限。null なら確かめない。数えるのは常に p_owner_id の記録（p_scope_owner に関係しない）

drop function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric, uuid);

create function public.reserve_sns_spend(
  p_owner_id uuid,
  p_sns public.sns_key,
  p_post_target_id uuid,
  p_operation text,
  p_cost_usd numeric,
  p_budget_usd numeric,
  p_scope_owner uuid default null,
  p_user_budget_usd numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_spent numeric;
  v_user_spent numeric;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('sns_api_usage:' || p_sns::text));
  if p_user_budget_usd is not null then
    select coalesce(sum(cost_usd), 0) into v_user_spent
      from public.sns_api_usage
     where sns = p_sns
       and owner_id = p_owner_id
       and operation in ('post', 'post_with_url', 'post_read', 'user_read')
       and created_at >= v_month_start;
    if v_user_spent + p_cost_usd > p_user_budget_usd then
      return null;
    end if;
  end if;
  if p_budget_usd is not null then
    select coalesce(sum(cost_usd), 0) into v_spent
      from public.sns_api_usage
     where sns = p_sns
       and created_at >= v_month_start
       and (p_scope_owner is null or owner_id = p_scope_owner);
    if v_spent + p_cost_usd > p_budget_usd then
      return null;
    end if;
  end if;
  insert into public.sns_api_usage (owner_id, sns, post_target_id, operation, cost_usd)
  values (p_owner_id, p_sns, p_post_target_id, p_operation, p_cost_usd)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric, uuid, numeric) from public, anon, authenticated;
grant execute on function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric, uuid, numeric) to service_role;

-- 投稿がまだあるかの確認（post_read）も、利用者ごとの上限に数える（1 日 30 件まででも、1 か月続けると $4.5 になり全体の上限を超えるため）
drop function public.reserve_sns_read(uuid, public.sns_key, uuid, numeric, numeric, integer, uuid);

create function public.reserve_sns_read(
  p_owner_id uuid,
  p_sns public.sns_key,
  p_post_target_id uuid,
  p_cost_usd numeric,
  p_budget_usd numeric,
  p_daily_limit integer,
  p_scope_owner uuid default null,
  p_user_budget_usd numeric default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_reads integer;
begin
  perform pg_advisory_xact_lock(hashtext('sns_api_usage:' || p_sns::text));
  select count(*) into v_reads
    from public.sns_api_usage
   where sns = p_sns and owner_id = p_owner_id and operation = 'post_read' and created_at >= v_day_start;
  if v_reads >= p_daily_limit then
    return null;
  end if;
  -- 同じトランザクションの中なので、reserve_sns_spend のロックは取り直しても待たない
  return public.reserve_sns_spend(p_owner_id, p_sns, p_post_target_id, 'post_read', p_cost_usd, p_budget_usd, p_scope_owner, p_user_budget_usd);
end;
$$;

revoke execute on function public.reserve_sns_read(uuid, public.sns_key, uuid, numeric, numeric, integer, uuid, numeric) from public, anon, authenticated;
grant execute on function public.reserve_sns_read(uuid, public.sns_key, uuid, numeric, numeric, integer, uuid, numeric) to service_role;

-- 利用者の、今月の X の投稿まわりの費用（概要の画面と、上限に達したときの文を分けるため。サーバーだけ）
create function public.x_post_spend_this_month(p_owner_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
    from public.sns_api_usage
   where sns = 'x'
     and owner_id = p_owner_id
     and operation in ('post', 'post_with_url', 'post_read', 'user_read')
     and created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
$$;

revoke execute on function public.x_post_spend_this_month(uuid) from public, anon, authenticated;
grant execute on function public.x_post_spend_this_month(uuid) to service_role;
