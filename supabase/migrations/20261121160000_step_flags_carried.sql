-- プロジェクトの一覧の「次にやること」（project_step_flags）を、ホームとロードマップと同じ決め方にする（2026-11-21 オーナーの指摘
-- 「ロードマップでは先週のやることがまだ残っているのに、ホームでは『今週のやることは、すべて完了しました』になっていた」）。
-- 1. 前の週から残っている、まだのやることの数（this_week_carried）を足す。前の週のやることで、手で済み・やらないにしておらず、
--    その週の数字でも達成していないもの（ロードマップの「まだ完了していない、前の週のこと」。src/lib/roadmap/load.ts の carriedTodos）
-- 2. 数えるのは今の目標のやること（目標のないやることを含む）。今の目標がなければ全部（src/lib/roadmap/load.ts の scopeToGoal）。
--    前は数だけ目標で絞っていなかった（ロードマップは絞って並べていた）
-- 決め方は src/lib/roadmap/schema.ts の effectiveStatus と同じ。tests/todo-achieved.integration.test.ts で突き合わせる。
-- 返す列が増えるので、drop してから作り直す。権限はいまと同じ（authenticated だけ。security invoker なので RLS のまま本人の行だけ）
drop function public.project_step_flags(uuid, date);

create function public.project_step_flags(p_project_id uuid, p_week_start date)
returns table (project_id uuid, has_published boolean, has_roadmap boolean, this_week_todo bigint, this_week_done bigint, this_week_carried bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    -- 今週のやること（まだ・済み）と、前の週のまだのやること。今の目標のものと、目標のないもの
    select i.id, i.project_id, i.kpi, i.target, i.status, i.week_start
      from public.roadmap_items i
      left join public.goals g on g.project_id = i.project_id and g.status = 'active'
     where (p_project_id is null or i.project_id = p_project_id)
       and (g.id is null or i.goal_id is null or i.goal_id = g.id)
       and ((i.week_start = p_week_start and i.status in ('todo', 'done')) or (i.week_start < p_week_start and i.status = 'todo'))
  ),
  -- 投稿の数（posts の数字）と、結びついた投稿の送信済みの数（数字で数えないやること）。やることの週ごとに数える（roadmap_item_progress）
  post_progress as (
    select pr.item_id, pr.published, pr.linked_published
      from (select o.project_id, min(o.week_start) as from_week from scoped o where o.status = 'todo' group by o.project_id) x
     cross join lateral public.roadmap_item_progress(x.project_id, x.from_week, p_week_start) pr
  ),
  -- クリックの数は、やることの週ごとに
  click_totals as (
    select o.id, coalesce(sum(d.link_clicks), 0) as clicks
      from scoped o
     cross join lateral public.roadmap_daily_totals(o.project_id, o.week_start, o.week_start + 6) d
     where o.kpi = 'link_clicks' and o.status = 'todo'
     group by o.id
  ),
  states as (
    select o.project_id,
           o.week_start = p_week_start as this_week,
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
      from scoped o
      left join post_progress pp on pp.item_id = o.id
      left join click_totals ct on ct.id = o.id
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
         (select count(*) from states s where s.project_id = p.id and s.this_week and not s.finished),
         (select count(*) from states s where s.project_id = p.id and s.this_week and s.finished),
         (select count(*) from states s where s.project_id = p.id and not s.this_week and not s.finished)
    from public.projects p
   where p_project_id is null or p.id = p_project_id
$$;
comment on function public.project_step_flags(uuid, date) is '「いまやること」の判定に使う、投稿済みか・ロードマップがあるか・今週のまだのやることと済んだやることの数・前の週から残っているまだのやることの数（今の目標のやることと目標のないやること。数字で目標に届いたもの・数字で数えないやることで結びついた投稿を送ったものは済み。一覧・ホーム・ロードマップで同じもの）';
revoke all on function public.project_step_flags(uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.project_step_flags(uuid, date) to authenticated;
