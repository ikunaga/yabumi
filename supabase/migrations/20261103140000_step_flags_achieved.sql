-- プロジェクトの一覧の「今週のやること あと n 件」（project_step_flags の this_week_todo）に、数字で目標に届いたやることを数えない（オーナーの指摘 2026-11-03）。
-- 自動で数える数字（posts・link_clicks）が付いたまだのやることは、その週の数字が目標に届いたら「達成」で、済みと同じに扱う。
-- DB の status は書き換えず、読むときに決める（数字があとで減ったら「まだ」に戻る）。決め方はアプリの effectiveStatus（src/lib/roadmap/schema.ts）と同じ:
--   posts: roadmap_item_progress の published（その週に送った配信先と、結びついた投稿の配信先を重ならないように数えたもの。SNS を決めていればその SNS だけ）
--   link_clicks: roadmap_daily_totals のその週（月〜日）の link_clicks の合計
-- 問い合わせはプロジェクトの数にかかわらず 1 回のまま。進み具合は、今週に数字の付いたまだのやることがあるプロジェクトだけ数える
create or replace function public.project_step_flags(p_project_id uuid, p_week_start date)
returns table (project_id uuid, has_published boolean, has_roadmap boolean, this_week_todo bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with open_items as (
    select i.id, i.project_id, i.kpi, i.target
      from public.roadmap_items i
     where (p_project_id is null or i.project_id = p_project_id)
       and i.week_start = p_week_start
       and i.status = 'todo'
  ),
  post_progress as (
    select pr.item_id, pr.published
      from (select distinct o.project_id from open_items o where o.kpi = 'posts') x
     cross join lateral public.roadmap_item_progress(x.project_id, p_week_start, p_week_start) pr
  ),
  click_totals as (
    select x.project_id, coalesce(sum(d.link_clicks), 0) as clicks
      from (select distinct o.project_id from open_items o where o.kpi = 'link_clicks') x
     cross join lateral public.roadmap_daily_totals(x.project_id, p_week_start, p_week_start + 6) d
     group by x.project_id
  ),
  still_open as (
    select o.project_id
      from open_items o
      left join post_progress pp on pp.item_id = o.id
      left join click_totals ct on ct.project_id = o.project_id
     where not (
       o.target is not null
       and ((o.kpi = 'posts' and coalesce(pp.published, 0) >= o.target)
         or (o.kpi = 'link_clicks' and coalesce(ct.clicks, 0) >= o.target))
     )
  )
  select p.id,
         exists (
           select 1
             from public.posts po
             join public.post_targets t on t.post_id = po.id
            where po.project_id = p.id
              and t.status = 'published'
         ),
         exists (select 1 from public.roadmaps r where r.project_id = p.id and r.kgi is not null)
           or exists (select 1 from public.roadmap_items i where i.project_id = p.id),
         (select count(*) from still_open s where s.project_id = p.id)
    from public.projects p
   where p_project_id is null or p.id = p_project_id
$$;

comment on function public.project_step_flags(uuid, date) is '「いまやること」の判定に使う、投稿済みか・ロードマップがあるか・今週のまだのやることの数（数字で目標に届いたものは数えない。一覧と概要で同じもの）';

revoke execute on function public.project_step_flags(uuid, date) from public, anon, authenticated;
grant execute on function public.project_step_flags(uuid, date) to authenticated;
