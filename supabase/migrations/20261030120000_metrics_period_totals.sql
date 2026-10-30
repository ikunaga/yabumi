-- 分析の期間の切り替え（7 日・30 日。数字の段 2、docs/roadmap.md の「数字の段」の A）。
-- 週ごとの関数（weekly_post_totals・sns_weekly_totals・store_weekly_totals・link_clicks_by_sns）と同じ数え方で、
-- 「直近 p_days 日（今日を含む）」と「その前の p_days 日」を返す。p_days は画面で選べる 7 か 30 だけを受け付け、ほかは弾く（22023）。
-- どれも security invoker で、RLS により本人のプロジェクトの行だけを数える

create function public.metrics_period_totals(p_project_id uuid, p_today date, p_days integer)
returns table (
  published_now bigint,
  published_prev bigint,
  manual_views_now bigint,
  manual_views_prev bigint,
  views_now bigint,
  views_prev bigint,
  followers_now bigint,
  followers_ago bigint,
  has_post_metrics boolean,
  has_account_metrics boolean,
  downloads_now bigint,
  downloads_prev bigint,
  page_views_now bigint,
  page_views_prev bigint,
  revenue_latest numeric,
  revenue_week_ago numeric,
  revenue_currency text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_days is null or p_days not in (7, 30) then
    raise exception '期間は 7 日か 30 日です（%）', p_days using errcode = '22023';
  end if;
  return query
  with params as (
    select p_days as n
  ),
  -- 送った投稿（送った日。日本時間）と、note・Substack で手で入れた閲覧数
  sent as (
    select c.target_id as id, c.day
      from params, public.counted_post_targets(p_project_id, p_today - (2 * params.n - 1), p_today) c
     where c.state = 'published'
  ),
  -- SNS の閲覧数: 配信先ごとのいちばん新しい views を、送った日で分ける
  latest as (
    select distinct on (m.post_target_id) m.post_target_id, (m."values" ->> 'views')::bigint as views, (t.published_at at time zone 'Asia/Tokyo')::date as day
      from public.post_metrics m
      join public.post_targets t on t.id = m.post_target_id
      join public.posts p on p.id = t.post_id, params
     where p.project_id = p_project_id
       and (t.published_at at time zone 'Asia/Tokyo')::date > p_today - 2 * params.n
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
      from public.account_metrics am join accounts using (social_account_id), params
     where am.day <= p_today - params.n
     order by am.social_account_id, am.day desc
  ),
  store as (
    select d.day, d.source, d."values"
      from public.store_daily d, params
     where d.project_id = p_project_id
       and d.day > p_today - 2 * params.n
  )
  select
    (select count(*) from sent, params where sent.day > p_today - params.n),
    (select count(*) from sent, params where sent.day <= p_today - params.n),
    (select coalesce(sum(m.views), 0)::bigint from sent join public.manual_post_metrics m on m.post_target_id = sent.id, params where sent.day > p_today - params.n),
    (select coalesce(sum(m.views), 0)::bigint from sent join public.manual_post_metrics m on m.post_target_id = sent.id, params where sent.day <= p_today - params.n),
    (select coalesce(sum(views), 0)::bigint from latest, params where day > p_today - params.n),
    (select coalesce(sum(views), 0)::bigint from latest, params where day <= p_today - params.n),
    (select sum(f)::bigint from now_f),
    (select sum(f)::bigint from ago_f),
    exists (select 1 from latest),
    exists (select 1 from now_f),
    (select coalesce(sum((s."values" ->> 'downloads')::bigint), 0)::bigint from store s, params where s.source in ('app_store', 'google_play') and s.day > p_today - params.n),
    (select coalesce(sum((s."values" ->> 'downloads')::bigint), 0)::bigint from store s, params where s.source in ('app_store', 'google_play') and s.day <= p_today - params.n),
    (select coalesce(sum((s."values" ->> 'page_views')::bigint), 0)::bigint from store s, params where s.source in ('app_store_views', 'google_play') and s.day > p_today - params.n),
    (select coalesce(sum((s."values" ->> 'page_views')::bigint), 0)::bigint from store s, params where s.source in ('app_store_views', 'google_play') and s.day <= p_today - params.n),
    -- 売上は RevenueCat の「直近 28 日」の数字だけなので、期間を切り替えない（いちばん新しい日と、その 7 日前）
    (select (d."values" ->> 'revenue')::numeric from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' order by d.day desc limit 1),
    (select (d."values" ->> 'revenue')::numeric from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' and d.day <= p_today - 7 order by d.day desc limit 1),
    (select d."values" ->> 'currency' from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' order by d.day desc limit 1);
end;
$$;

revoke execute on function public.metrics_period_totals(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.metrics_period_totals(uuid, date, integer) to authenticated;

-- SNS ごとのストアへのクリック（直近 p_days 日・その前の p_days 日・30 日）
create function public.link_clicks_by_sns_period(p_project_id uuid, p_today date, p_days integer)
returns table (sns text, clicks_now bigint, clicks_prev bigint, last_30d bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_days is null or p_days not in (7, 30) then
    raise exception '期間は 7 日か 30 日です（%）', p_days using errcode = '22023';
  end if;
  return query
  with params as (
    select p_days as n
  )
  select coalesce(l.sns::text, ''),
         coalesce(sum(d.clicks) filter (where d.day > p_today - params.n), 0),
         coalesce(sum(d.clicks) filter (where d.day > p_today - 2 * params.n and d.day <= p_today - params.n), 0),
         coalesce(sum(d.clicks) filter (where d.day > p_today - 30), 0)
    from params, public.short_links l
    join public.link_click_daily d on d.link_id = l.id
   where l.project_id = p_project_id
     and d.day > p_today - greatest(2 * params.n, 30)
   group by coalesce(l.sns::text, ''), params.n;
end;
$$;

revoke execute on function public.link_clicks_by_sns_period(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.link_clicks_by_sns_period(uuid, date, integer) to authenticated;
