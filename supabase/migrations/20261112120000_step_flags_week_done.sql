-- プロジェクトの一覧の「次にやること」で、今週のやることが全部済んだ週と、まだ決めていない週を見分ける（オーナーの Notion の項目
-- 「今週のやることおわってるのにプロジェクト一覧に反映されない」2026-11-12）。前は「まだ」の数だけを返していて、0 件だと
-- どちらも「今週のやることを見る」になり、済んだことが伝わらなかった。
-- this_week_done: p_week_start の週のやることのうち、済んだもの（手で済みにした done ＋数字で目標に届いた todo）。やらない（skipped）は数えない。
-- 決め方は src/lib/roadmap/schema.ts の effectiveStatus・isFinished と同じ（tests/todo-achieved.integration.test.ts で突き合わせる）。
-- 返す列が変わるので作り直す。中身は 20261106150000_goals.sql の定義に this_week_done を足しただけ。権限はいまと同じ
drop function public.project_step_flags(uuid, date);

create function public.project_step_flags(p_project_id uuid, p_week_start date)
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
  post_progress as (
    select pr.item_id, pr.published
      from (select distinct o.project_id from week_items o where o.kpi = 'posts' and o.status = 'todo') x
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
             o.target is not null
             and ((o.kpi = 'posts' and coalesce(pp.published, 0) >= o.target)
               or (o.kpi = 'link_clicks' and coalesce(ct.clicks, 0) >= o.target))
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
comment on function public.project_step_flags(uuid, date) is '「いまやること」の判定に使う、投稿済みか・ロードマップがあるか・今週のまだのやることと済んだやることの数（数字で目標に届いたものは済み。一覧と概要で同じもの）';
revoke execute on function public.project_step_flags(uuid, date) from public, anon, authenticated;
grant execute on function public.project_step_flags(uuid, date) to authenticated;
