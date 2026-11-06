-- セキュリティ確認（2026-11-06）の M1 と L3 の直し。本番にはまだ当たっていないので 20261106150000・150100・160000 の中も同じに直した。
-- ここは、もう当てた DB（ローカル）を同じ中身にそろえるための作り直し（本番では同じものを当て直すだけ）。
-- M1: 前のデータの日付（startedOn・deadline）を、正規表現で形だけ確かめて ::date にしていたので、2026-02-30 のようなありえない日が 1 件あると
--     写し替え全体（db push）が落ちた。本人が roadmaps・account_plans に直接書けるので、わざと入れることもできた。
--     日付は legacy_date（形と pg_input_is_valid）、数は legacy_number（形）で読み、合わない値は写さない
-- L3: ensure_active_goal と roadmap_items_check_goal が start_goal の advisory lock を取らず、目標を替えている最中に足したやることが
--     閉じた目標につながることがあった。同じ goals:<project> のロックを取る

create or replace function public.legacy_date(p text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when p ~ '^\d{4}-\d{2}-\d{2}$' and pg_catalog.pg_input_is_valid(p, 'date') then p::date end;
$$;

create or replace function public.legacy_number(p text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p ~ '^\d{1,9}(\.\d{1,6})?$' then p::numeric end;
$$;

revoke all on function public.legacy_date(text) from public, anon, authenticated, service_role;
revoke all on function public.legacy_number(text) from public, anon, authenticated, service_role;

create or replace function public.sync_goal_from_legacy_parts(p_project_id uuid, p_kgi boolean, p_kpis boolean, p_actions text, p_milestone boolean)
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

  if r.project_id is not null and p_kgi then
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
  end if;

  if r.project_id is not null and p_kpis then
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

  -- 行動の目標: weekly（アカウント設計の週の回数）から / roadmaps（kpi_targets の posts。週の回数がないときだけ）から / auto（週の回数があればそれ、なければ roadmaps）
  if p_actions in ('weekly', 'auto') and v_weekly is not null then
    delete from public.goal_kpis where goal_id = v_id and role = 'action';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'action', 'posts', w.key::public.sns_key, least(14, greatest(1, round(public.legacy_number(w.value::text)))), (w.ordinality - 1)::integer
      from jsonb_each(v_weekly) with ordinality w
     where pg_catalog.pg_input_is_valid(w.key, 'public.sns_key')
       and coalesce(public.legacy_number(w.value::text) >= 1, false);
  elsif p_actions in ('roadmaps', 'auto') and v_weekly is null and r.project_id is not null then
    delete from public.goal_kpis where goal_id = v_id and role = 'action';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'action', 'posts', case when pg_catalog.pg_input_is_valid(t.value ->> 'sns', 'public.sns_key') then (t.value ->> 'sns')::public.sns_key end,
           least(14, greatest(1, round(public.legacy_number(t.value ->> 'per_week')))), (t.ordinality - 1)::integer
      from jsonb_array_elements(case when jsonb_typeof(r.kpi_targets) = 'array' then r.kpi_targets else '[]'::jsonb end) with ordinality t
     where t.value ->> 'kpi' = 'posts'
       and coalesce(public.legacy_number(t.value ->> 'per_week') > 0, false)
    on conflict do nothing;
  end if;

  if p_milestone and v_started is not null and not exists (select 1 from public.goal_milestones m where m.goal_id = v_id and m.starts_on = v_started) then
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

revoke all on function public.sync_goal_from_legacy_parts(uuid, boolean, boolean, text, boolean) from public, anon, authenticated, service_role;

create or replace function public.ensure_active_goal(p_project_id uuid, p_owner_id uuid, p_starts_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- start_goal と同じロック（目標を替えている最中に、閉じる前の目標を拾わない。同じトランザクションの中なら取り直しても待たない）
  perform pg_advisory_xact_lock(hashtext('goals:' || p_project_id::text));
  select g.id into v_id from public.goals g where g.project_id = p_project_id and g.status = 'active';
  if v_id is not null then
    return v_id;
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id) then
    raise exception 'project owner mismatch' using errcode = '42501';
  end if;
  insert into public.goals (project_id, owner_id, starts_on)
  values (p_project_id, p_owner_id, coalesce(p_starts_on, (now() at time zone 'Asia/Tokyo')::date))
  on conflict (project_id) where status = 'active' do nothing
  returning id into v_id;
  if v_id is null then
    select g.id into v_id from public.goals g where g.project_id = p_project_id and g.status = 'active';
  end if;
  return v_id;
end;
$$;

revoke all on function public.ensure_active_goal(uuid, uuid, date) from public, anon, authenticated, service_role;

create or replace function public.roadmap_items_check_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- start_goal と同じロック（替えている最中の目標に、やることをつながない）
  perform pg_advisory_xact_lock(hashtext('goals:' || new.project_id::text));
  if new.goal_id is null then
    new.goal_id := public.ensure_active_goal(new.project_id, new.owner_id, new.week_start);
  end if;
  if not exists (
    select 1 from public.goals g
     where g.id = new.goal_id and g.project_id = new.project_id and g.owner_id = new.owner_id
       and (tg_op = 'UPDATE' or g.status = 'active')
  ) then
    raise exception 'invalid goal for roadmap item' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.roadmap_items_check_goal() from public, anon, authenticated, service_role;
