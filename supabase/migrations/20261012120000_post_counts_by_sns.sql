-- 投稿の数え方を 1 か所にまとめ、SNS ごとに数えられるようにする（docs/architecture.md の 4.23・4.27）。
-- 不具合（オーナーが本番で見つけた、2026-10-12）: ロードマップのやること「Instagram に…を 1 本」が、Instagram に送っていないのに
-- 「投稿した回数: 2 / 1」になった。roadmap_daily_totals が、プロジェクトの送信済みの配信先を SNS に関係なく数えていたため。
-- 指標（weekly_post_totals）・ロードマップ（roadmap_daily_totals）・伴走（4.27）は、どれも counted_post_targets から数える。

-- ===== 数える配信先（1 か所） =====
-- published: 送信済み（手で投稿する SNS は「投稿した」の記録）。日は送った日（日本時間）
-- scheduled: 予約済みでまだ送っていないもの（予約の投稿の、送る前・送っている途中の配信先）。日は予約の日（日本時間）。失敗・下書きは数えない
-- p_project_id が null のときは、見えるすべてのプロジェクト（利用者は RLS で本人のものだけ。サーバーの毎日のジョブはすべて）。
-- security invoker なので RLS が効く。期間は 400 日まで
create function public.counted_post_targets(p_project_id uuid, p_from date, p_to date)
returns table (target_id uuid, project_id uuid, sns text, day date, state text)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, p.project_id, t.sns::text, (t.published_at at time zone 'Asia/Tokyo')::date, 'published'
    from public.post_targets t
    join public.posts p on p.id = t.post_id
   where (p_project_id is null or p.project_id = p_project_id)
     and t.status = 'published'
     and t.published_at is not null
     and (t.published_at at time zone 'Asia/Tokyo')::date between p_from and least(p_to, p_from + 400)
  union all
  select t.id, p.project_id, t.sns::text, (p.planned_at at time zone 'Asia/Tokyo')::date, 'scheduled'
    from public.post_targets t
    join public.posts p on p.id = t.post_id
   where (p_project_id is null or p.project_id = p_project_id)
     and p.status = 'scheduled'
     and p.planned_at is not null
     and t.status in ('pending', 'preparing', 'publishing')
     and (p.planned_at at time zone 'Asia/Tokyo')::date between p_from and least(p_to, p_from + 400)
$$;

comment on function public.counted_post_targets(uuid, date, date) is '投稿の数え方の 1 か所（送信済みは送った日、予約済みは予約の日。日本時間）。指標・ロードマップ・伴走が使う';

-- 日ごと・SNS ごとの数（送信済みと予約済み）
create function public.post_counts_by_day(p_project_id uuid, p_from date, p_to date)
returns table (project_id uuid, day date, sns text, published bigint, scheduled bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.project_id, c.day, c.sns, count(*) filter (where c.state = 'published'), count(*) filter (where c.state = 'scheduled')
    from public.counted_post_targets(p_project_id, p_from, p_to) c
   group by 1, 2, 3
$$;

revoke execute on function public.counted_post_targets(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.post_counts_by_day(uuid, date, date) from public, anon, authenticated;
grant execute on function public.counted_post_targets(uuid, date, date) to authenticated;
grant execute on function public.post_counts_by_day(uuid, date, date) to authenticated;

-- ===== 指標とロードマップの合計も、同じ数え方から =====
create or replace function public.weekly_post_totals(p_project_id uuid, p_today date)
returns table (published_this_week bigint, published_last_week bigint, manual_views_this_week bigint, manual_views_last_week bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select c.target_id as id, c.day
      from public.counted_post_targets(p_project_id, p_today - 13, p_today) c
     where c.state = 'published'
  )
  select count(*) filter (where t.day > p_today - 7),
         count(*) filter (where t.day <= p_today - 7),
         coalesce(sum(m.views) filter (where t.day > p_today - 7), 0),
         coalesce(sum(m.views) filter (where t.day <= p_today - 7), 0)
    from t
    left join public.manual_post_metrics m on m.post_target_id = t.id;
$$;

-- posts はすべての SNS の合計（SNS ごとは post_counts_by_day）
create or replace function public.roadmap_daily_totals(p_project_id uuid, p_from date, p_to date)
returns table (day date, posts bigint, link_clicks bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select d::date as day
      from generate_series(p_from, least(p_to, p_from + 400), interval '1 day') d
  ),
  posted as (
    select c.day, count(*) as n
      from public.counted_post_targets(p_project_id, p_from, p_to) c
     where c.state = 'published'
     group by 1
  ),
  clicked as (
    select c.day, sum(c.clicks) as n
      from public.link_click_daily c
      join public.short_links l on l.id = c.link_id
     where l.project_id = p_project_id
       and c.day between p_from and p_to
     group by 1
  )
  select days.day, coalesce(posted.n, 0), coalesce(clicked.n, 0)
    from days
    left join posted on posted.day = days.day
    left join clicked on clicked.day = days.day
   order by days.day;
$$;

-- ===== ロードマップのやること・目標に SNS を持たせる（null はすべての SNS） =====
-- SNS を選べるのは「投稿した回数」だけ（ほかの数字は SNS ごとに数えていない）
alter table public.roadmap_items add column sns public.sns_key;
alter table public.roadmap_items add constraint roadmap_items_sns_only_posts check (sns is null or kpi = 'posts');

-- KPI の週の目標は、SNS ごとの「投稿した回数」を並べられるように 6 つまで（kgi と kpi_targets の SNS は jsonb の "sns"）
alter table public.roadmaps drop constraint roadmaps_kpi_targets_check;
alter table public.roadmaps add constraint roadmaps_kpi_targets_check check (jsonb_typeof(kpi_targets) = 'array' and jsonb_array_length(kpi_targets) <= 6);

-- 前に作ったやることのうち、題が「Instagram に」「X で」のように SNS の名前で始まる「投稿した回数」のものは、その SNS にする。
-- ほかは null（すべての SNS）のまま、画面に「すべての SNS」と出す
update public.roadmap_items i
   set sns = m.sns
  from (values ('x', 'X'), ('threads', 'Threads'), ('instagram', 'Instagram'), ('facebook', 'Facebook'), ('tiktok', 'TikTok'), ('youtube', 'YouTube'), ('note', 'note'), ('substack', 'Substack')) as m (sns, label)
 where i.kpi = 'posts'
   and i.sns is null
   and i.title ~* ('^\s*[「『]?' || m.label || '[」』]?\s*(に|で|へ|の|用)');
