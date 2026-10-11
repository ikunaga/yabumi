-- SNS の数字の取り込み（F07 の段取り ④。Threads・Instagram・Facebook ページ）。方針は docs/architecture.md の 4.22
-- 送った投稿の数字を、送ってから決まった日（1・3・7・30 日目。Instagram は数字が最大 48 時間遅れるので 2・4・8・31 日目）に読み、
-- アカウントの数字（フォロワー数）を毎日読む。書き込みはサーバー（service_role）だけ。利用者は自分のものを読めるだけ

-- ===== 投稿の数字（配信先 × 何日目） =====
-- values の名前は SNS をまたいでそろえる: views、reach、likes、replies、reposts、quotes、shares、saves、clicks
create table public.post_metrics (
  post_target_id uuid not null references public.post_targets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  day_index smallint not null check (day_index between 1 and 31),
  captured_at timestamptz not null default now(),
  "values" jsonb not null default '{}'::jsonb,
  primary key (post_target_id, day_index)
);

create index post_metrics_owner_idx on public.post_metrics (owner_id);

alter table public.post_metrics enable row level security;
create policy "post_metrics_select_own" on public.post_metrics
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.post_metrics from anon, authenticated;
grant select on public.post_metrics to authenticated;

-- ===== アカウントの数字（アカウント × 日。日本時間） =====
create table public.account_metrics (
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  "values" jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  primary key (social_account_id, day)
);

create index account_metrics_owner_idx on public.account_metrics (owner_id, day);

alter table public.account_metrics enable row level security;
create policy "account_metrics_select_own" on public.account_metrics
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.account_metrics from anon, authenticated;
grant select on public.account_metrics to authenticated;

-- ===== 読む時期が来た投稿（サーバーだけ） =====
-- 送ってから day_index 日たち、まだその日の数字がないもの。3 日を過ぎたら、その日の分はあきらめる（次の日の分で読む）
create function public.due_post_metric_targets(p_limit integer default 100, p_owner_id uuid default null, p_now timestamptz default now())
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
     and t.sns in ('threads', 'instagram', 'facebook')
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

revoke execute on function public.due_post_metric_targets(integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.due_post_metric_targets(integer, uuid, timestamptz) to service_role;

-- 今日（日本時間）のフォロワー数をまだ読んでいないアカウント（直近 90 日に送った投稿があるものだけ）
create function public.due_account_metric_accounts(p_limit integer default 100, p_owner_id uuid default null, p_now timestamptz default now())
returns table (social_account_id uuid, owner_id uuid, sns text, external_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.owner_id, a.sns::text, a.external_id
    from public.social_accounts a
   where a.status = 'active'
     and a.sns in ('threads', 'instagram', 'facebook')
     and (p_owner_id is null or a.owner_id = p_owner_id)
     and exists (
       select 1 from public.post_targets t
        where t.social_account_id = a.id and t.status = 'published' and t.published_at > p_now - interval '90 days'
     )
     and not exists (
       select 1 from public.account_metrics m
        where m.social_account_id = a.id and m.day = (p_now at time zone 'Asia/Tokyo')::date
     )
   limit p_limit;
$$;

revoke execute on function public.due_account_metric_accounts(integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.due_account_metric_accounts(integer, uuid, timestamptz) to service_role;

-- ===== 数字の画面の合計（security invoker で本人のものだけ） =====
-- 閲覧数: 直近 7 日・その前の 7 日に送った投稿の、いちばん新しい数字の views の合計
-- フォロワー: プロジェクトにつないだアカウントの、いちばん新しい数の合計と、7 日前（以前でいちばん近い日）の合計
create function public.sns_weekly_totals(p_project_id uuid, p_today date)
returns table (views_this_week bigint, views_last_week bigint, followers_now bigint, followers_week_ago bigint, has_post_metrics boolean, has_account_metrics boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (m.post_target_id) m.post_target_id, (m."values" ->> 'views')::bigint as views, (t.published_at at time zone 'Asia/Tokyo')::date as day
      from public.post_metrics m
      join public.post_targets t on t.id = m.post_target_id
      join public.posts p on p.id = t.post_id
     where p.project_id = p_project_id
       and (t.published_at at time zone 'Asia/Tokyo')::date > p_today - 14
     order by m.post_target_id, m.day_index desc
  ),
  accounts as (
    select psa.social_account_id from public.project_social_accounts psa where psa.project_id = p_project_id
  ),
  now_f as (
    select distinct on (am.social_account_id) (am."values" ->> 'followers')::bigint as f
      from public.account_metrics am join accounts using (social_account_id)
     order by am.social_account_id, am.day desc
  ),
  ago_f as (
    select distinct on (am.social_account_id) (am."values" ->> 'followers')::bigint as f
      from public.account_metrics am join accounts using (social_account_id)
     where am.day <= p_today - 7
     order by am.social_account_id, am.day desc
  )
  select
    (select coalesce(sum(views), 0) from latest where day > p_today - 7),
    (select coalesce(sum(views), 0) from latest where day <= p_today - 7),
    (select sum(f) from now_f),
    (select sum(f) from ago_f),
    exists (select 1 from latest),
    exists (select 1 from now_f);
$$;

revoke execute on function public.sns_weekly_totals(uuid, date) from public, anon, authenticated;
grant execute on function public.sns_weekly_totals(uuid, date) to authenticated;

-- よく見られた投稿（直近 p_days 日に送ったもの。配信先ごとのいちばん新しい views を投稿ごとに合計）
create function public.top_posts_by_views(p_project_id uuid, p_today date, p_days integer default 30, p_limit integer default 5)
returns table (post_id uuid, views bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with latest as (
    select distinct on (m.post_target_id) t.post_id, (m."values" ->> 'views')::bigint as views
      from public.post_metrics m
      join public.post_targets t on t.id = m.post_target_id
      join public.posts p on p.id = t.post_id
     where p.project_id = p_project_id
       and (t.published_at at time zone 'Asia/Tokyo')::date > p_today - p_days
     order by m.post_target_id, m.day_index desc
  )
  select post_id, sum(views) from latest group by post_id having coalesce(sum(views), 0) > 0 order by sum(views) desc limit p_limit;
$$;

revoke execute on function public.top_posts_by_views(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.top_posts_by_views(uuid, date, integer, integer) to authenticated;

-- 毎日 5:00（日本時間）から 10 分おきに 6 回: SNS の数字の取り込み
select cron.schedule('yabumi-import-sns-metrics', '0,10,20,30,40,50 20 * * *', $$select public.invoke_job('/api/jobs/import-sns-metrics')$$);
