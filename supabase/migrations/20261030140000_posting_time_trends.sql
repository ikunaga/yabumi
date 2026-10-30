-- 時間帯ごとの傾向（数字の段 4、docs/roadmap.md の「数字の段」の C）。カレンダーの右の列と、投稿をつくるの日時の欄で使う。
-- 時間帯は日本時間の 4 つ: 朝（5〜10 時台）・昼（11〜15 時台）・夕（16〜19 時台）・夜（20〜4 時台）。src/lib/metrics/time-bands.ts と同じ分け方
-- - 閲覧: 直近 90 日に送った配信先ごとのいちばん新しい views（SNS から取り込んだもの）と、note・Substack で手で入れた閲覧数を、送った時間帯で分けて、本数と平均を返す
-- - クリック: 直近 90 日の短縮リンクのクリック（ボット・重複を除いたもの）を、押された時間帯で数える。1 回ずつの記録（link_clicks）は利用者には読めないので
--   security definer にし、プロジェクトの持ち主でなければ何も返さない（ほかの人のプロジェクトを指しても 0 件）
-- 比べてよいか（5 本・5 回未満の帯は比べない）は画面の側で決める

create function public.time_band_of(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when extract(hour from p_at at time zone 'Asia/Tokyo') between 5 and 10 then 'morning'
    when extract(hour from p_at at time zone 'Asia/Tokyo') between 11 and 15 then 'noon'
    when extract(hour from p_at at time zone 'Asia/Tokyo') between 16 and 19 then 'evening'
    else 'night'
  end;
$$;

revoke execute on function public.time_band_of(timestamptz) from public, anon, authenticated;
grant execute on function public.time_band_of(timestamptz) to authenticated;

create function public.posting_time_trends(p_project_id uuid, p_today date)
returns table (band text, posts bigint, avg_views numeric, clicks bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- 持ち主の確かめは、ログインしている本人（auth.uid()）とプロジェクトの owner_id で。ログインしていなければ何も返さない
  if (select auth.uid()) is null
     or not exists (select 1 from public.projects pr where pr.id = p_project_id and pr.owner_id = (select auth.uid())) then
    return;
  end if;
  return query
  with sent as (
    select t.id, t.published_at
      from public.post_targets t
      join public.posts p on p.id = t.post_id
     where p.project_id = p_project_id
       and t.status = 'published'
       and t.published_at is not null
       and (t.published_at at time zone 'Asia/Tokyo')::date > p_today - 90
       and (t.published_at at time zone 'Asia/Tokyo')::date <= p_today
  ),
  -- 配信先ごとの閲覧数（SNS のいちばん新しい日。なければ手で入れた数）
  views as (
    select s.published_at,
           coalesce(
             (select (m."values" ->> 'views')::numeric from public.post_metrics m
               where m.post_target_id = s.id and m."values" ? 'views' order by m.day_index desc limit 1),
             (select mm.views::numeric from public.manual_post_metrics mm where mm.post_target_id = s.id)
           ) as v
      from sent s
  ),
  v_band as (
    select public.time_band_of(published_at) as band, count(*) as posts, avg(v) as avg_views
      from views where v is not null group by 1
  ),
  c_band as (
    select public.time_band_of(c.clicked_at) as band, count(*) as clicks
      from public.link_clicks c
      join public.short_links l on l.id = c.link_id
     where l.project_id = p_project_id
       and c.excluded is null
       and (c.clicked_at at time zone 'Asia/Tokyo')::date > p_today - 90
       and (c.clicked_at at time zone 'Asia/Tokyo')::date <= p_today
     group by 1
  ),
  bands as (
    select unnest(array['morning', 'noon', 'evening', 'night']) as band
  )
  select b.band, coalesce(v.posts, 0)::bigint, v.avg_views, coalesce(c.clicks, 0)::bigint
    from bands b
    left join v_band v on v.band = b.band
    left join c_band c on c.band = b.band;
end;
$$;

revoke execute on function public.posting_time_trends(uuid, date) from public, anon, authenticated;
grant execute on function public.posting_time_trends(uuid, date) to authenticated;
