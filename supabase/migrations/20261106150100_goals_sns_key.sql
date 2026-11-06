-- 20261106150000_goals の sync_goal_from_legacy が、ドメイン（sns_key は enum ではなく text のドメイン）に enum_range を使っていて、
-- 週の回数のあるアカウント設計を保存すると落ちていた（ローカルに当てたあと、伴走のテストで見つけた。本番にはまだ当たっていない）。
-- SNS の名前は pg_input_is_valid でドメインに合うかを確かめ、合わないものは写さない。20261106150000 の中も同じに直した。
-- ここは、もう当てた DB を同じ中身にそろえるための作り直し（本番では同じものを当て直すだけ）
create or replace function public.sync_goal_from_legacy(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.roadmaps;
  v_owner uuid;
  v_fm jsonb;
  v_weekly jsonb;
  v_started date;
  v_kgi_ok boolean := false;
  v_id uuid;
  v_seq integer;
begin
  select p.owner_id into v_owner from public.projects p where p.id = p_project_id;
  if v_owner is null then
    return null;
  end if;
  select * into r from public.roadmaps where project_id = p_project_id;
  select a.data -> 'first_month' into v_fm from public.account_plans a where a.project_id = p_project_id;
  v_weekly := case when jsonb_typeof(v_fm -> 'weekly') = 'object' and v_fm -> 'weekly' <> '{}'::jsonb then v_fm -> 'weekly' end;
  -- 日付は形だけでなく、ありえる日か（2026-02-30 などは写さない）。合わない値で写し替え全体を落とさない
  v_started := public.legacy_date(v_fm ->> 'startedOn');
  if v_started is not null and extract(isodow from v_started) <> 1 then
    v_started := null;
  end if;
  if r.project_id is null and v_weekly is null and not exists (select 1 from public.roadmap_items i where i.project_id = p_project_id) then
    return null;
  end if;

  v_id := public.ensure_active_goal(p_project_id, v_owner, coalesce(r.started_on, v_started, (select min(i.week_start) from public.roadmap_items i where i.project_id = p_project_id)));

  if r.project_id is not null then
    v_kgi_ok := r.kgi is not null and jsonb_typeof(r.kgi) = 'object'
      and coalesce(r.kgi ->> 'kpi', '') in ('posts', 'link_clicks', 'downloads', 'store_page_views', 'revenue', 'followers', 'views')
      and coalesce(public.legacy_number(r.kgi ->> 'target') between 0.000001 and 10000000, false)
      and coalesce(public.legacy_date(r.kgi ->> 'deadline') > r.started_on, false);
    if v_kgi_ok then
      update public.goals
         set statement = left(coalesce(nullif(r.kgi ->> 'statement', ''), '目標'), 120),
             metric = r.kgi ->> 'kpi',
             action = null,
             sns = case when r.kgi ->> 'kpi' = 'posts' and pg_catalog.pg_input_is_valid(r.kgi ->> 'sns', 'public.sns_key') then (r.kgi ->> 'sns')::public.sns_key end,
             target = public.legacy_number(r.kgi ->> 'target'),
             starts_on = r.started_on,
             ends_on = least(public.legacy_date(r.kgi ->> 'deadline'), r.started_on + 371),
             source = r.source
       where id = v_id;
    end if;
    delete from public.goal_kpis where goal_id = v_id and role = 'kpi';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'kpi', t.value ->> 'kpi',
           case when t.value ->> 'kpi' in ('followers', 'views') and pg_catalog.pg_input_is_valid(t.value ->> 'sns', 'public.sns_key') then (t.value ->> 'sns')::public.sns_key end,
           public.legacy_number(t.value ->> 'per_week'), (t.ordinality - 1)::integer
      from jsonb_array_elements(case when jsonb_typeof(r.kpi_targets) = 'array' then r.kpi_targets else '[]'::jsonb end) with ordinality t
     where t.value ->> 'kpi' in ('link_clicks', 'downloads', 'store_page_views', 'revenue', 'followers', 'views')
       and coalesce(public.legacy_number(t.value ->> 'per_week') > 0, false)
    on conflict do nothing;
  end if;

  if v_weekly is not null then
    delete from public.goal_kpis where goal_id = v_id and role = 'action';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'action', 'posts', w.key::public.sns_key, least(14, greatest(1, round(public.legacy_number(w.value::text)))), (w.ordinality - 1)::integer
      from jsonb_each(v_weekly) with ordinality w
     where pg_catalog.pg_input_is_valid(w.key, 'public.sns_key')
       and coalesce(public.legacy_number(w.value::text) >= 1, false);
  elsif r.project_id is not null then
    delete from public.goal_kpis where goal_id = v_id and role = 'action';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'action', 'posts', case when pg_catalog.pg_input_is_valid(t.value ->> 'sns', 'public.sns_key') then (t.value ->> 'sns')::public.sns_key end,
           least(14, greatest(1, round(public.legacy_number(t.value ->> 'per_week')))), (t.ordinality - 1)::integer
      from jsonb_array_elements(case when jsonb_typeof(r.kpi_targets) = 'array' then r.kpi_targets else '[]'::jsonb end) with ordinality t
     where t.value ->> 'kpi' = 'posts'
       and coalesce(public.legacy_number(t.value ->> 'per_week') > 0, false)
    on conflict do nothing;
  end if;

  if v_started is not null and not exists (select 1 from public.goal_milestones m where m.goal_id = v_id and m.starts_on = v_started) then
    delete from public.goal_milestones m where m.goal_id = v_id and m.starts_on > v_started;
    update public.goal_milestones m set ends_on = v_started - 1
     where m.goal_id = v_id and m.starts_on < v_started and m.ends_on >= v_started;
    select coalesce(max(m.seq), 0) + 1 into v_seq from public.goal_milestones m where m.goal_id = v_id;
    insert into public.goal_milestones (goal_id, owner_id, seq, starts_on, ends_on)
    values (v_id, v_owner, v_seq, v_started, v_started + 27);
  end if;
  return v_id;
end;
$$;

revoke all on function public.sync_goal_from_legacy(uuid) from public, anon, authenticated, service_role;
-- サーバーだけ（写し替えを 1 つのプロジェクトに流して確かめる結合テストと、運営の手当てに使う）
grant execute on function public.sync_goal_from_legacy(uuid) to service_role;
