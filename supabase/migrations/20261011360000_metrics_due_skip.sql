-- SNS の数字を読む時期の関数で、読めないものを先に除く（docs/architecture.md の 4.22。2026-10-11）。
-- これまでは時期が来たものを古い順に p_limit 件返し、読めるか（SNS_INSIGHTS で有効か、数字の権限があるか、X の費用の上限に
-- 収まるか）はアプリの側で確かめていた。読めないものが p_limit 件を超えて溜まると、後ろの読める投稿に手が届かなかった。
-- そこで、アプリから「有効な SNS と、その数字の権限」と「X の上限」を渡し、関数の中で読めないものを除いてから p_limit 件にする。
-- 上限の数え方は reserve_x_metrics_read と同じ（本当に読むときは、そちらがロックの中でもう一度確かめる）

drop function public.due_post_metric_targets(integer, uuid, timestamptz);
drop function public.due_account_metric_accounts(integer, uuid, timestamptz);

-- X の数字を、この利用者がもう 1 件読めるか（利用者ごとの月の上限と、矢書全体の X の月の上限）。
-- p_budget_usd・p_user_budget_usd が null なら読まない（設定がない）
create function public.x_metrics_room(p_owner_id uuid, p_cost_usd numeric, p_budget_usd numeric, p_user_budget_usd numeric, p_scope_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_budget_usd is not null and p_user_budget_usd is not null
     and (select coalesce(sum(u.cost_usd), 0) from public.sns_api_usage u
           where u.sns = 'x' and u.owner_id = p_owner_id and u.operation in ('metrics_read', 'followers_read')
             and u.created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') + p_cost_usd <= p_user_budget_usd
     and (select coalesce(sum(u.cost_usd), 0) from public.sns_api_usage u
           where u.sns = 'x' and (p_scope_owner is null or u.owner_id = p_scope_owner)
             and u.created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') + p_cost_usd <= p_budget_usd;
$$;

revoke execute on function public.x_metrics_room(uuid, numeric, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.x_metrics_room(uuid, numeric, numeric, numeric, uuid) to service_role;

-- p_insights: 読む SNS と、その数字の権限（例 {"threads": "threads_manage_insights", "x": "tweet.read"}）。ここにない SNS は返さない
-- p_x: X の上限（{"cost_usd", "budget_usd", "user_budget_usd", "scope_owner"}）。ないと X は返さない
create function public.due_post_metric_targets(
  p_insights jsonb,
  p_x jsonb default null,
  p_limit integer default 100,
  p_owner_id uuid default null,
  p_now timestamptz default now()
)
returns table (post_target_id uuid, owner_id uuid, sns text, external_post_id text, social_account_id uuid, account_external_id text, day_index smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.owner_id, t.sns::text, t.external_post_id, t.social_account_id, a.external_id, d.idx::smallint
    from public.post_targets t
    join public.social_accounts a on a.id = t.social_account_id
    join public.social_account_tokens k on k.social_account_id = a.id
    cross join lateral unnest(
      case when t.sns = 'instagram' then array[2, 4, 8, 31] else array[1, 3, 7, 30] end
    ) as d(idx)
   where t.status = 'published'
     and p_insights ? t.sns::text
     and k.scopes @> array[p_insights ->> t.sns::text]
     and t.external_post_id is not null
     and t.published_at is not null
     and a.status = 'active'
     and (p_owner_id is null or t.owner_id = p_owner_id)
     and p_now >= t.published_at + make_interval(days => d.idx)
     and p_now < t.published_at + make_interval(days => d.idx + 3)
     and not exists (select 1 from public.post_metrics m where m.post_target_id = t.id and m.day_index = d.idx)
     and (t.sns <> 'x' or (p_x is not null and public.x_metrics_room(
       t.owner_id, (p_x ->> 'cost_usd')::numeric, (p_x ->> 'budget_usd')::numeric, (p_x ->> 'user_budget_usd')::numeric, (p_x ->> 'scope_owner')::uuid)))
   order by t.published_at
   limit p_limit;
$$;

revoke execute on function public.due_post_metric_targets(jsonb, jsonb, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.due_post_metric_targets(jsonb, jsonb, integer, uuid, timestamptz) to service_role;

create function public.due_account_metric_accounts(
  p_insights jsonb,
  p_x jsonb default null,
  p_limit integer default 100,
  p_owner_id uuid default null,
  p_now timestamptz default now()
)
returns table (social_account_id uuid, owner_id uuid, sns text, external_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.owner_id, a.sns::text, a.external_id
    from public.social_accounts a
    join public.social_account_tokens k on k.social_account_id = a.id
   where a.status = 'active'
     and p_insights ? a.sns::text
     and k.scopes @> array[p_insights ->> a.sns::text]
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
     and (a.sns <> 'x' or (p_x is not null and public.x_metrics_room(
       a.owner_id, (p_x ->> 'cost_usd')::numeric, (p_x ->> 'budget_usd')::numeric, (p_x ->> 'user_budget_usd')::numeric, (p_x ->> 'scope_owner')::uuid)))
   order by a.id
   limit p_limit;
$$;

revoke execute on function public.due_account_metric_accounts(jsonb, jsonb, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.due_account_metric_accounts(jsonb, jsonb, integer, uuid, timestamptz) to service_role;
