-- 橋渡し（20261106150000 の sync_goal_from_legacy をトリガーから流すもの）が、新しいコードが goals に書いた KGI・KPI を、前の作りの古い値で上書きしていた
-- （実装担当3 の指摘 2026-11-06。アカウント設計の保存のたびに全部を写し直し、前のアカウント設計の保存は roadmaps.kpi_targets も書くので KPI も入れ直していた）。
-- 本番にはまだ当たっていない。トリガーで OLD と NEW を比べ、前のコードが変えた部分だけを写す形にする:
-- - roadmaps: kgi か started_on が変わったら KGI。kpi_targets の posts 以外が変わったら KPI。posts の部分が変わったら行動の目標（週の回数がないときだけ）。
--   足したとき（insert）は、中身のある部分だけ（addItems が作る空の行で、goals に書いた KPI を消さない）
-- - account_plans: first_month.weekly が変わったら行動の目標、startedOn が変わったら区切り。KGI と KPI には触らない
-- 新しいコード（段階 ② ③）は roadmaps と first_month.weekly・startedOn を書かないので、橋渡しは前のコードの書き込みだけを写す（docs/design/goals-model.md の 10.4）。
-- マイグレーションの写し替えと運営の手当て（sync_goal_from_legacy）は、今までどおり全部を写す

create function public.sync_goal_from_legacy_parts(p_project_id uuid, p_kgi boolean, p_kpis boolean, p_actions text, p_milestone boolean)
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

-- 全部を写す（写し替え・運営の手当て・結合テスト）。前と同じ結果
create or replace function public.sync_goal_from_legacy(p_project_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.sync_goal_from_legacy_parts(p_project_id, true, true, 'auto', true);
$$;

revoke all on function public.sync_goal_from_legacy(uuid) from public, anon, authenticated, service_role;
grant execute on function public.sync_goal_from_legacy(uuid) to service_role;

-- kpi_targets の posts 以外・posts だけ（比べるため）
create function public.legacy_kpi_targets_part(p_targets jsonb, p_posts boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(t.value order by t.ordinality), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_targets) = 'array' then p_targets else '[]'::jsonb end) with ordinality t
   where (t.value ->> 'kpi' = 'posts') = p_posts;
$$;

revoke all on function public.legacy_kpi_targets_part(jsonb, boolean) from public, anon, authenticated, service_role;

drop trigger roadmaps_bridge_to_goals on public.roadmaps;
drop trigger account_plans_bridge_to_goals on public.account_plans;
drop function public.legacy_bridge_to_goals();

create function public.roadmaps_bridge_to_goals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insert boolean := tg_op = 'INSERT';
  v_kgi boolean;
  v_kpis boolean;
  v_posts boolean;
begin
  v_kgi := case when v_insert then new.kgi is not null else old.kgi is distinct from new.kgi or old.started_on is distinct from new.started_on end;
  v_kpis := case when v_insert then public.legacy_kpi_targets_part(new.kpi_targets, false) <> '[]'::jsonb
                 else public.legacy_kpi_targets_part(old.kpi_targets, false) is distinct from public.legacy_kpi_targets_part(new.kpi_targets, false) end;
  v_posts := case when v_insert then public.legacy_kpi_targets_part(new.kpi_targets, true) <> '[]'::jsonb
                  else public.legacy_kpi_targets_part(old.kpi_targets, true) is distinct from public.legacy_kpi_targets_part(new.kpi_targets, true) end;
  if v_kgi or v_kpis or v_posts then
    perform public.sync_goal_from_legacy_parts(new.project_id, v_kgi, v_kpis, case when v_posts then 'roadmaps' end, false);
  end if;
  return new;
end;
$$;

revoke all on function public.roadmaps_bridge_to_goals() from public, anon, authenticated, service_role;

create function public.account_plans_bridge_to_goals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then old.data -> 'first_month' end;
  v_new jsonb := new.data -> 'first_month';
  v_weekly boolean := v_old -> 'weekly' is distinct from v_new -> 'weekly';
  v_started boolean := v_old ->> 'startedOn' is distinct from v_new ->> 'startedOn';
begin
  if v_weekly or v_started then
    perform public.sync_goal_from_legacy_parts(new.project_id, false, false, case when v_weekly then 'weekly' end, v_started);
  end if;
  return new;
end;
$$;

revoke all on function public.account_plans_bridge_to_goals() from public, anon, authenticated, service_role;

create trigger roadmaps_bridge_to_goals after insert or update of kgi, kpi_targets, started_on on public.roadmaps
  for each row execute function public.roadmaps_bridge_to_goals();
create trigger account_plans_bridge_to_goals after insert or update of data on public.account_plans
  for each row
  when (new.data -> 'first_month' is not null)
  execute function public.account_plans_bridge_to_goals();

-- ===== start_goal の直し（実装担当3 の指摘と PM の方針 2026-11-06） =====
-- 1. KGI まだの目標から初めて KGI を決めるときは、新しい行を作らず、その目標に KGI を書き入れる（中身のない replaced を「これまでの目標」に残さない）。
--    数え始めは KGI を決めた週の月曜。区切りは KGI の期間に合わせて作り直す（今週より前に始まった区切りは先週の日曜で終え、今週から並べ直す）。
--    KGI まだのまま（p_goal が null）なら、何も閉じない（KPI・行動の目標だけ渡されたら入れ替える）
-- 2. 別の目標に替えたときは、今週以降のまだのやること（todo）を新しい目標に付け替える。済み・やらない・先週より前のものは、前の目標の記録として残す
create or replace function public.start_goal(p_project_id uuid, p_goal jsonb, p_milestones jsonb, p_kpis jsonb, p_actions jsonb, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_monday date := v_today - (extract(isodow from v_today)::integer - 1);
  v_prev public.goals;
  v_fill boolean;
  v_has_goal boolean := p_goal is not null and jsonb_typeof(p_goal) <> 'null';
  v_id uuid;
  v_weeks integer;
  v_ms integer;
  v_base_seq integer := 0;
begin
  if v_uid is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_uid) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  if p_source not in ('ai', 'manual') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if v_has_goal then
    v_weeks := coalesce((p_goal ->> 'weeks')::integer, 12);
    if v_weeks < 4 or v_weeks > 52 then
      raise exception 'invalid weeks' using errcode = '22023';
    end if;
  else
    v_weeks := 4;
  end if;
  perform pg_advisory_xact_lock(hashtext('goals:' || p_project_id::text));
  select * into v_prev from public.goals g where g.project_id = p_project_id and g.status = 'active';
  v_fill := v_prev.id is not null and v_prev.metric is null;

  if v_fill then
    v_id := v_prev.id;
    if v_has_goal then
      -- 今週より前に始まった区切りは先週の日曜で終え（KGI まだの期間なので結果は数えない）、今週から先の区切りは並べ直す
      update public.goal_milestones m
         set ends_on = least(m.ends_on, v_monday - 1), settled_at = coalesce(m.settled_at, now())
       where m.goal_id = v_id and m.starts_on < v_monday;
      delete from public.goal_milestones m where m.goal_id = v_id and m.starts_on >= v_monday;
      select coalesce(max(m.seq), 0) into v_base_seq from public.goal_milestones m where m.goal_id = v_id;
      update public.goals
         set statement = p_goal ->> 'statement', metric = p_goal ->> 'metric', action = nullif(p_goal ->> 'action', ''),
             sns = nullif(p_goal ->> 'sns', '')::public.sns_key, target = (p_goal ->> 'target')::numeric,
             starts_on = v_monday, ends_on = v_monday + v_weeks * 7 - 1,
             provisional = coalesce((p_goal ->> 'provisional')::boolean, false), source = p_source
       where id = v_id;
    end if;
  else
    if v_prev.id is not null then
      perform public.close_goal_internal(v_prev.id, true);
    end if;
    if v_has_goal then
      insert into public.goals (project_id, owner_id, statement, metric, action, sns, target, starts_on, ends_on, provisional, source)
      values (
        p_project_id, v_uid,
        p_goal ->> 'statement', p_goal ->> 'metric', nullif(p_goal ->> 'action', ''), nullif(p_goal ->> 'sns', '')::public.sns_key,
        (p_goal ->> 'target')::numeric, v_monday, v_monday + v_weeks * 7 - 1,
        coalesce((p_goal ->> 'provisional')::boolean, false), p_source
      )
      returning id into v_id;
    else
      insert into public.goals (project_id, owner_id, starts_on, source)
      values (p_project_id, v_uid, v_monday, p_source)
      returning id into v_id;
    end if;
  end if;

  -- 中間の目標: 4 週ごと（最後の区切りは期限まで）。KGI まだのまま書き入れなかったときは作らない
  if not (v_fill and not v_has_goal) then
    v_ms := greatest(1, ceil(v_weeks / 4.0)::integer);
    insert into public.goal_milestones (goal_id, owner_id, seq, starts_on, ends_on, target)
    select v_id, v_uid, v_base_seq + s, v_monday + (s - 1) * 28, least(v_monday + s * 28 - 1, v_monday + v_weeks * 7 - 1),
           case when v_has_goal and p_milestones is not null and jsonb_typeof(p_milestones) = 'array' then nullif(p_milestones ->> (s - 1), '')::numeric end
      from generate_series(1, v_ms) s;
  end if;

  if p_kpis is not null and jsonb_typeof(p_kpis) = 'array' then
    perform public.replace_goal_kpis_internal(v_id, v_uid, 'kpi', p_kpis);
  end if;
  if p_actions is not null and jsonb_typeof(p_actions) = 'array' then
    perform public.replace_goal_kpis_internal(v_id, v_uid, 'action', p_actions);
  elsif not v_fill and v_prev.id is not null then
    insert into public.goal_kpis (goal_id, owner_id, role, metric, action, sns, per_week, position)
    select v_id, v_uid, k.role, k.metric, k.action, k.sns, k.per_week, k.position
      from public.goal_kpis k where k.goal_id = v_prev.id and k.role = 'action';
  end if;

  -- 別の目標に替えたら、今週以降のまだのやることを新しい目標へ
  if not v_fill and v_prev.id is not null then
    update public.roadmap_items i
       set goal_id = v_id
     where i.goal_id = v_prev.id and i.status = 'todo' and i.week_start >= v_monday;
  end if;
  return v_id;
end;
$$;

revoke all on function public.start_goal(uuid, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.start_goal(uuid, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
