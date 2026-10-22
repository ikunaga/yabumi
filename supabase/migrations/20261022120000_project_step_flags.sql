-- プロジェクトごとの「いまやること」（src/lib/projects/next-step.ts）の判定に使う値のうち、投稿とロードマップの分を、
-- 見えるプロジェクトの数にかかわらず 1 回の問い合わせで返す（docs/architecture.md の 4.23）。
-- 不具合（オーナーが本番で見つけた、2026-10-22）: プロジェクト一覧の「次にやること」が、投稿済みのプロジェクトでもいつも
-- 「最初の投稿をつくる」になった。一覧が投稿済みかとロードマップの有無を渡していなかったため。一覧も概要もこの関数から取る。
--
-- has_published: 送信済みの配信先が 1 つでもある（概要の「最初の投稿」が済んだかの基準と同じ）
-- has_roadmap: 最終の目標（kgi）か、やることが 1 つでもある
-- this_week_todo: p_week_start の週のやることのうち、まだのもの（4 段階が済んだあと、一覧に出す）
-- p_project_id が null のときは、見えるすべてのプロジェクト。security invoker なので RLS で本人のものだけ
create function public.project_step_flags(p_project_id uuid, p_week_start date)
returns table (project_id uuid, has_published boolean, has_roadmap boolean, this_week_todo bigint)
language sql
stable
security invoker
set search_path = ''
as $$
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
         (select count(*) from public.roadmap_items i where i.project_id = p.id and i.week_start = p_week_start and i.status = 'todo')
    from public.projects p
   where p_project_id is null or p.id = p_project_id
$$;

comment on function public.project_step_flags(uuid, date) is '「いまやること」の判定に使う、投稿済みか・ロードマップがあるか・今週のまだのやることの数（一覧と概要で同じもの）';

revoke execute on function public.project_step_flags(uuid, date) from public, anon, authenticated;
grant execute on function public.project_step_flags(uuid, date) to authenticated;
