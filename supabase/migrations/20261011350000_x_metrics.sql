-- X の数字（F07 の段取り ⑥、決定 D19）。方針は docs/architecture.md の 4.22
-- X の読み取りは従量課金（投稿 1 件 $0.005、ユーザー 1 件 $0.010）。送ってから 1・3・7・30 日目に投稿の数字を読み、
-- フォロワー数は週に 1 回読む。費用は sns_api_usage に読む前に記録し、矢書全体の X の月の上限（投稿と共有）に数えるうえ、
-- 利用者ごとの「X の数字」の月の上限も確かめる（同じロックの中で。同時に読んでも超えない）

alter table public.sns_api_usage drop constraint sns_api_usage_operation_check;
alter table public.sns_api_usage add constraint sns_api_usage_operation_check
  check (operation in ('post', 'post_with_url', 'user_read', 'post_read', 'metrics_read', 'followers_read'));

-- X の数字の費用を記録する（サーバーだけ）。利用者の今月の X の数字の費用が p_user_budget_usd を超えるなら null。
-- そのうえで矢書全体の X の月の上限を reserve_sns_spend で確かめる
create function public.reserve_x_metrics_read(
  p_owner_id uuid,
  p_post_target_id uuid,
  p_operation text,
  p_cost_usd numeric,
  p_budget_usd numeric,
  p_user_budget_usd numeric,
  p_scope_owner uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_user_spent numeric;
begin
  if p_operation not in ('metrics_read', 'followers_read') then
    raise exception 'operation must be metrics_read or followers_read';
  end if;
  perform pg_advisory_xact_lock(hashtext('sns_api_usage:x'));
  select coalesce(sum(cost_usd), 0) into v_user_spent
    from public.sns_api_usage
   where sns = 'x' and owner_id = p_owner_id and operation in ('metrics_read', 'followers_read') and created_at >= v_month_start;
  if v_user_spent + p_cost_usd > p_user_budget_usd then
    return null;
  end if;
  return public.reserve_sns_spend(p_owner_id, 'x', p_post_target_id, p_operation, p_cost_usd, p_budget_usd, p_scope_owner);
end;
$$;

revoke execute on function public.reserve_x_metrics_read(uuid, uuid, text, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.reserve_x_metrics_read(uuid, uuid, text, numeric, numeric, numeric, uuid) to service_role;

-- 本人の、今月の X の数字の費用（指標の画面に「上限に達しました」を出すため。security invoker で本人の分だけ）
create function public.my_x_metrics_spend_this_month()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
    from public.sns_api_usage
   where sns = 'x' and owner_id = (select auth.uid()) and operation in ('metrics_read', 'followers_read')
     and created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
$$;

revoke execute on function public.my_x_metrics_spend_this_month() from public, anon, authenticated;
grant execute on function public.my_x_metrics_spend_this_month() to authenticated;

-- ===== 読む時期: X を足す（投稿は 1・3・7・30 日目、フォロワーは 7 日に 1 回） =====
create or replace function public.due_post_metric_targets(p_limit integer default 100, p_owner_id uuid default null, p_now timestamptz default now())
returns table (post_target_id uuid, owner_id uuid, sns text, external_post_id text, social_account_id uuid, account_external_id text, day_index smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.owner_id, t.sns::text, t.external_post_id, t.social_account_id, a.external_id, d.idx::smallint
    from public.post_targets t
    join public.social_accounts a on a.id = t.social_account_id
    cross join lateral unnest(
      case when t.sns = 'instagram' then array[2, 4, 8, 31] else array[1, 3, 7, 30] end
    ) as d(idx)
   where t.status = 'published'
     and t.sns in ('threads', 'instagram', 'facebook', 'x')
     and t.external_post_id is not null
     and t.published_at is not null
     and a.status = 'active'
     and (p_owner_id is null or t.owner_id = p_owner_id)
     and p_now >= t.published_at + make_interval(days => d.idx)
     and p_now < t.published_at + make_interval(days => d.idx + 3)
     and not exists (select 1 from public.post_metrics m where m.post_target_id = t.id and m.day_index = d.idx)
   order by t.published_at
   limit p_limit;
$$;

create or replace function public.due_account_metric_accounts(p_limit integer default 100, p_owner_id uuid default null, p_now timestamptz default now())
returns table (social_account_id uuid, owner_id uuid, sns text, external_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.owner_id, a.sns::text, a.external_id
    from public.social_accounts a
   where a.status = 'active'
     and a.sns in ('threads', 'instagram', 'facebook', 'x')
     and (p_owner_id is null or a.owner_id = p_owner_id)
     and exists (
       select 1 from public.post_targets t
        where t.social_account_id = a.id and t.status = 'published' and t.published_at > p_now - interval '90 days'
     )
     and not exists (
       select 1 from public.account_metrics m
        where m.social_account_id = a.id
          -- X は読むたびに費用がかかるので、フォロワー数は 7 日に 1 回
          and m.day > (p_now at time zone 'Asia/Tokyo')::date - case when a.sns = 'x' then 7 else 1 end
     )
   limit p_limit;
$$;
