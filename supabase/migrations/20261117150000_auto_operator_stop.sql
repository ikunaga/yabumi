-- 運営者が止めた回し方（auto_plans.stop_reason = 'operator'）を、利用者が消して作り直して外せないようにする（push のあとの自動のセキュリティレビューの R4）。
-- つなぎの塞ぎ方。利用者ごと（またはプロジェクトごと）に止める仕組みは docs/launch-checklist.md の 1.1（② の前）。
-- プロジェクトごと消すと、回し方も一緒に消える（その道は、利用者ごとに止める仕組みで塞ぐ）
-- 20261116100000_auto_post の定義の写しに、確かめを 1 つずつ足す

create or replace function public.save_auto_plan(
  p_plan_id uuid,
  p_project_id uuid,
  p_name text,
  p_kind text,
  p_materials jsonb,
  p_targets jsonb,
  p_x_link text,
  p_schedule jsonb,
  p_tone text,
  p_lead_hours integer,
  p_consent boolean
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_version date;
  v_id uuid;
  v_key text;
  v_mode text;
  v_day jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_consent is not true then
    raise exception 'consent required' using errcode = '22023', hint = 'consent_required';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_uid) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  -- 運営者が止めた回し方があるプロジェクトでは、作る・直すを断る（消して作り直して、止めたのを外させない）
  if exists (select 1 from public.auto_plans a where a.project_id = p_project_id and a.owner_id = v_uid and a.stop_reason = 'operator') then
    raise exception 'stopped by operator' using errcode = '42501', hint = 'auto_plan_operator_stop';
  end if;
  select max(c.version) into v_version from public.legal_consents c where c.user_id = v_uid;
  if v_version is null then
    raise exception 'legal consent missing' using errcode = '22023', hint = 'legal_consent_missing';
  end if;

  -- 送り方: SNS ごとに決まった送り方だけ（X・TikTok・YouTube は確かめて送る、note・Substack は手で投稿。docs/design/auto-post.md の 4.1）。
  -- 自動で送れる SNS を確かめて送るにするのはよい
  if jsonb_typeof(p_targets) <> 'object' or p_targets = '{}'::jsonb or (select count(*) from jsonb_object_keys(p_targets)) > 8 then
    raise exception 'invalid targets' using errcode = '22023';
  end if;
  for v_key, v_mode in select k, p_targets->>k from jsonb_object_keys(p_targets) as k loop
    if not (
      (v_key in ('threads', 'instagram', 'facebook') and v_mode in ('auto', 'review'))
      or (v_key in ('x', 'tiktok', 'youtube') and v_mode = 'review')
      or (v_key in ('note', 'substack') and v_mode = 'by_hand')
    ) then
      raise exception 'invalid target mode' using errcode = '22023';
    end if;
  end loop;

  -- くり返しの規則: 曜日 1〜7（重ならない 1〜7 個）・時刻 HH:MM（15 分刻み）・何週ごと 1〜4・始まりの日
  if jsonb_typeof(p_schedule->'weekdays') <> 'array'
     or jsonb_array_length(p_schedule->'weekdays') not between 1 and 7
     or (select count(distinct d) from jsonb_array_elements(p_schedule->'weekdays') d) <> jsonb_array_length(p_schedule->'weekdays')
     or not coalesce(p_schedule->>'time' ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$', false)
     or jsonb_typeof(p_schedule->'every_weeks') <> 'number'
     or (p_schedule->>'every_weeks')::numeric not in (1, 2, 3, 4)
     or not coalesce(p_schedule->>'start' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false)
     or (select count(*) from jsonb_object_keys(p_schedule)) <> 4 then
    raise exception 'invalid schedule' using errcode = '22023';
  end if;
  for v_day in select * from jsonb_array_elements(p_schedule->'weekdays') loop
    if jsonb_typeof(v_day) <> 'number' or v_day::numeric not in (1, 2, 3, 4, 5, 6, 7) then
      raise exception 'invalid schedule' using errcode = '22023';
    end if;
  end loop;
  perform (p_schedule->>'start')::date;

  -- 材料: 決まったキーだけ。ほかの表を指すもの（フォーマット・行き先）は、自分のプロジェクトのものだけ
  -- （ジョブはサーバーの権限で材料を読むので、ほかの人のものを指させない）
  if jsonb_typeof(coalesce(p_materials, '{}'::jsonb)) <> 'object'
     or exists (select 1 from jsonb_object_keys(coalesce(p_materials, '{}'::jsonb)) k where k not in ('format_id', 'destination_ids', 'note_order', 'skip_if_empty')) then
    raise exception 'invalid materials' using errcode = '22023';
  end if;
  if p_materials ? 'format_id' and not exists (
    select 1 from public.post_formats f where f.id = (p_materials->>'format_id')::uuid and f.owner_id = v_uid and f.project_id = p_project_id
  ) then
    raise exception 'invalid materials' using errcode = '22023';
  end if;
  if p_materials ? 'destination_ids' and (
    jsonb_typeof(p_materials->'destination_ids') <> 'array'
    or jsonb_array_length(p_materials->'destination_ids') > 20
    or exists (
      select 1 from jsonb_array_elements_text(p_materials->'destination_ids') d
       where not exists (select 1 from public.project_destinations x where x.id = d::uuid and x.project_id = p_project_id and x.owner_id = v_uid)
    )
  ) then
    raise exception 'invalid materials' using errcode = '22023';
  end if;

  if p_plan_id is null then
    -- 1 プロジェクト 10 件まで。同時に作っても超えないよう、プロジェクトの行を押さえてから数える
    perform 1 from public.projects p where p.id = p_project_id for update;
    if (select count(*) from public.auto_plans a where a.project_id = p_project_id) >= 10 then
      raise exception 'auto_plans limit' using errcode = 'P0001', hint = 'auto_plans_limit';
    end if;
    insert into public.auto_plans (owner_id, project_id, name, kind, materials, targets, x_link, schedule, tone, lead_hours, consented_at, consent_version)
    values (v_uid, p_project_id, btrim(p_name), p_kind, coalesce(p_materials, '{}'::jsonb), p_targets, p_x_link, p_schedule, coalesce(p_tone, ''), p_lead_hours, now(), v_version)
    returning id into v_id;
  else
    update public.auto_plans
       set name = btrim(p_name), kind = p_kind, materials = coalesce(p_materials, '{}'::jsonb), targets = p_targets, x_link = p_x_link,
           schedule = p_schedule, tone = coalesce(p_tone, ''), lead_hours = p_lead_hours,
           consented_at = now(), consent_version = v_version, updated_at = now()
     where id = p_plan_id and owner_id = v_uid and project_id = p_project_id
     returning id into v_id;
    if v_id is null then
      raise exception 'plan not found' using errcode = 'P0002';
    end if;
    delete from public.auto_runs r where r.plan_id = v_id and r.status = 'waiting';
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text, integer, boolean) to authenticated;

create or replace function public.delete_auto_plan(p_plan_id uuid, p_to_draft boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid) then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  -- 運営者が止めた回し方は、利用者からは消せない（消して作り直して、止めたのを外させない）
  if exists (select 1 from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid and a.stop_reason = 'operator') then
    raise exception 'stopped by operator' using errcode = '42501', hint = 'auto_plan_operator_stop';
  end if;
  perform public.auto_cancel_unsent_runs(v_uid, (select array_agg(r.id) from public.auto_runs r where r.plan_id = p_plan_id and r.due_at > now()), coalesce(p_to_draft, true), 'plan_paused');
  delete from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid;
end;
$$;
revoke all on function public.delete_auto_plan(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.delete_auto_plan(uuid, boolean) to authenticated;
