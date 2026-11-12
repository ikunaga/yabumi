-- 数字で数えないやること（自動で数える数字（posts・link_clicks）がない・目標の値がない）は、そのやることから作った投稿
-- （posts.roadmap_item_id で結びついた投稿）の配信先が 1 つ以上送信済みになったら済みに数える（2026-11-12 PMO の本番での通しテスト。PM の依頼）。
-- 前は手でチェックするまで「まだ」に残り、プロジェクトの一覧の「今週のやること あと n 件」も減らなかった。予約だけ・失敗だけでは済みにしない。
-- 決め方は src/lib/roadmap/schema.ts の effectiveStatus と同じ（roadmap_item_progress の linked_published。tests/todo-achieved.integration.test.ts で突き合わせる）。
-- 返す列は変わらないので create or replace。中身は 20261112120000_step_flags_week_done.sql の定義に、結びついた投稿の分を足しただけ。権限はいまと同じ
create or replace function public.project_step_flags(p_project_id uuid, p_week_start date)
returns table (project_id uuid, has_published boolean, has_roadmap boolean, this_week_todo bigint, this_week_done bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with week_items as (
    select i.id, i.project_id, i.kpi, i.target, i.status
      from public.roadmap_items i
     where (p_project_id is null or i.project_id = p_project_id)
       and i.week_start = p_week_start
       and i.status in ('todo', 'done')
  ),
  -- 投稿の数（posts の数字）と、結びついた投稿の送信済みの数（数字で数えないやること）。まだのやることがあるプロジェクトだけ数える
  post_progress as (
    select pr.item_id, pr.published, pr.linked_published
      from (select distinct o.project_id from week_items o where o.status = 'todo') x
     cross join lateral public.roadmap_item_progress(x.project_id, p_week_start, p_week_start) pr
  ),
  click_totals as (
    select x.project_id, coalesce(sum(d.link_clicks), 0) as clicks
      from (select distinct o.project_id from week_items o where o.kpi = 'link_clicks' and o.status = 'todo') x
     cross join lateral public.roadmap_daily_totals(x.project_id, p_week_start, p_week_start + 6) d
     group by x.project_id
  ),
  states as (
    select o.project_id,
           o.status = 'done' or (
             case
               -- 自動で数える数字があるやることは、その週の数字が目標に届いたら
               when o.target is not null and o.kpi in ('posts', 'link_clicks') then
                 (o.kpi = 'posts' and coalesce(pp.published, 0) >= o.target)
                 or (o.kpi = 'link_clicks' and coalesce(ct.clicks, 0) >= o.target)
               -- 数字で数えないやることは、結びついた投稿を 1 本以上送ったら
               else coalesce(pp.linked_published, 0) >= 1
             end
           ) as finished
      from week_items o
      left join post_progress pp on pp.item_id = o.id
      left join click_totals ct on ct.project_id = o.project_id
  )
  select p.id,
         exists (
           select 1
             from public.posts po
             join public.post_targets t on t.post_id = po.id
            where po.project_id = p.id
              and t.status = 'published'
         ),
         exists (select 1 from public.goals g where g.project_id = p.id and g.metric is not null)
           or exists (select 1 from public.roadmap_items i where i.project_id = p.id),
         (select count(*) from states s where s.project_id = p.id and not s.finished),
         (select count(*) from states s where s.project_id = p.id and s.finished)
    from public.projects p
   where p_project_id is null or p.id = p_project_id
$$;
comment on function public.project_step_flags(uuid, date) is '「いまやること」の判定に使う、投稿済みか・ロードマップがあるか・今週のまだのやることと済んだやることの数（数字で目標に届いたもの・数字で数えないやることで結びついた投稿を送ったものは済み。一覧と概要で同じもの）';
revoke execute on function public.project_step_flags(uuid, date) from public, anon, authenticated;
grant execute on function public.project_step_flags(uuid, date) to authenticated;
