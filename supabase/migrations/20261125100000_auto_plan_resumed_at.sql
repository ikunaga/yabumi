-- 自動投稿の回し方の「再開した時刻」と「止めた知らせを届けた時刻」（2026-11-25 本番: 回し方が止まり、再開しても同じ履歴から次のジョブで止め直す作りだった。
-- 止めた知らせはスマホの通知だけで、端末がないと届かず、記録も残らなかった）。
-- 1. auto_plans.resumed_at: 「再開する」（set_auto_plan_status）と、変数を決め直して保存して動かし直したとき（save_auto_plan）に入れる。
--    続けての失敗（engine.ts の reviewPlans）は、これより後に送る回だけで数える
-- 2. auto_plans.stop_notified_at: yabumi が止めた知らせを届けた時刻（サーバーだけが書く）。届かなかったら空のままにして、次のジョブでまた知らせる
-- 関数は 20261121180000_format_variables の定義（DB に当たっているもの）の写しに、上の 2 つを入れるところだけ足した。revoke・grant は前と同じ
alter table public.auto_plans add column resumed_at timestamptz;
alter table public.auto_plans add column stop_notified_at timestamptz;
comment on column public.auto_plans.resumed_at is '再開した時刻。続けての失敗は、これより後に送る回だけで数える（サーバーが書く）';
comment on column public.auto_plans.stop_notified_at is 'yabumi が止めたことを利用者に届けた時刻。空なら次のジョブでまた知らせる（サーバーが書く）';

CREATE OR REPLACE FUNCTION public.set_auto_plan_status(p_project_id uuid, p_plan_id uuid, p_status text, p_to_draft boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_plans uuid[];
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_status not in ('active', 'paused') or (p_plan_id is null and p_status <> 'paused') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  -- 運営者が利用者ごとに止めている間は、再開を断る（止めるのはよい）
  if p_status = 'active' and public.auto_post_held(v_uid) then
    raise exception 'auto post held' using errcode = '42501', hint = 'auto_post_hold';
  end if;
  if p_status = 'active' and exists (
    select 1 from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid and a.project_id = p_project_id and a.stop_reason = 'format_changed'
  ) then
    raise exception 'format changed' using errcode = '22023', hint = 'auto_plan_format_changed';
  end if;
  select array_agg(a.id) into v_plans from public.auto_plans a
   where a.owner_id = v_uid and a.project_id = p_project_id and (p_plan_id is null or a.id = p_plan_id)
     and a.stop_reason is distinct from 'operator';
  if v_plans is null then
    if p_plan_id is null then return 0; end if;
    if exists (select 1 from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid and a.project_id = p_project_id) then
      raise exception 'stopped by operator' using errcode = '42501', hint = 'auto_plan_operator_stop';
    end if;
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if p_status = 'paused' then
    -- 変数が変わって止めた回し方は、止めても「要確認」のまま（「再開する」で決め直さずに動かさない）
    update public.auto_plans a set status = 'paused', stop_reason = null, updated_at = now() where a.id = any(v_plans) and a.stop_reason is distinct from 'format_changed';
    perform public.auto_cancel_unsent_runs(v_uid, (select array_agg(r.id) from public.auto_runs r where r.plan_id = any(v_plans) and r.due_at > now()), coalesce(p_to_draft, true), 'plan_paused');
  else
    -- 再開した時刻を残す（続けての失敗は、これより後の回だけで数える。止めた知らせの記録も消す）
    update public.auto_plans a set status = 'active', stop_reason = null, fail_streak = 0, resumed_at = now(), stop_notified_at = null, updated_at = now() where a.id = any(v_plans);
    -- 止めている間に取り消した、まだ来ていない回は作り直す（ジョブが規則から足し直す）
    delete from public.auto_runs r where r.plan_id = any(v_plans) and r.status = 'canceled' and r.reason = 'plan_paused' and r.due_at > now() and r.post_id is null;
  end if;
  return array_length(v_plans, 1);
end;
$function$;
revoke all on function public.set_auto_plan_status(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_auto_plan_status(uuid, uuid, text, boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.save_auto_plan(p_plan_id uuid, p_project_id uuid, p_name text, p_kind text, p_materials jsonb, p_targets jsonb, p_x_link text, p_schedule jsonb, p_instructions jsonb, p_lead_hours integer, p_consent boolean, p_image jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_version date;
  v_id uuid;
  v_key text;
  v_mode text;
  v_day jsonb;
  v_materials jsonb := coalesce(p_materials, '{}'::jsonb);
  v_series jsonb;
  v_prev_stop text;
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
  -- 運営者が利用者ごとに止めている間は、作る・直すを断る（プロジェクトを作り直しても外れない）
  if public.auto_post_held(v_uid) then
    raise exception 'auto post held' using errcode = '42501', hint = 'auto_post_hold';
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
  -- （ジョブはサーバーの権限で材料を読むので、ほかの人のものを指させない）。format_var_modes は利用者からは受け取らない（下で決める）
  v_materials := v_materials - 'format_var_modes';
  if jsonb_typeof(v_materials) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_materials) k where k not in ('format_id', 'destination_ids', 'note_order', 'skip_if_empty', 'format_vars')) then
    raise exception 'invalid materials' using errcode = '22023';
  end if;
  if v_materials ? 'format_id' then
    select f.series into v_series from public.post_formats f where f.id = (v_materials->>'format_id')::uuid and f.owner_id = v_uid and f.project_id = p_project_id;
    if not found then
      raise exception 'invalid materials' using errcode = '22023';
    end if;
  end if;
  if v_materials ? 'destination_ids' and (
    jsonb_typeof(v_materials->'destination_ids') <> 'array'
    or jsonb_array_length(v_materials->'destination_ids') > 20
    or exists (
      select 1 from jsonb_array_elements_text(v_materials->'destination_ids') d
       where not exists (select 1 from public.project_destinations x where x.id = d::uuid and x.project_id = p_project_id and x.owner_id = v_uid)
    )
  ) then
    raise exception 'invalid materials' using errcode = '22023';
  end if;
  -- 「自分で入れる」変数の決め方: {名前: {"value": 毎回同じ言葉 1〜200 字} | {"instruction": AI への指示 1〜60 字}}。
  -- シリーズでは、フォーマットの「自分で入れる」変数をすべて決めていないと保存できない（決めていない変数を空のまま送らない）
  if v_materials ? 'format_vars' and (
    p_kind <> 'series' or v_series is null
    or jsonb_typeof(v_materials->'format_vars') <> 'object'
    or exists (
      select 1 from jsonb_each(v_materials->'format_vars') e
       where jsonb_typeof(e.value) <> 'object'
          or not (
            ((e.value - 'value') = '{}'::jsonb and coalesce(jsonb_typeof(e.value->'value'), '') = 'string' and char_length(btrim(e.value->>'value')) between 1 and 200)
            or ((e.value - 'instruction') = '{}'::jsonb and coalesce(jsonb_typeof(e.value->'instruction'), '') = 'string' and char_length(btrim(e.value->>'instruction')) between 1 and 60)
          )
    )
  ) then
    raise exception 'invalid materials' using errcode = '22023';
  end if;
  if p_kind = 'series' and v_series is not null then
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_series->'vars', '[]'::jsonb)) v
       where v->>'mode' = 'hand' and not coalesce(v_materials->'format_vars' ? (v->>'name'), false)
    ) or exists (
      select 1 from jsonb_object_keys(coalesce(v_materials->'format_vars', '{}'::jsonb)) k
       where not exists (select 1 from jsonb_array_elements(coalesce(v_series->'vars', '[]'::jsonb)) v where v->>'name' = k and v->>'mode' = 'hand')
    ) then
      raise exception 'format vars undecided' using errcode = '22023', hint = 'auto_format_vars_undecided';
    end if;
    v_materials := v_materials || jsonb_build_object('format_var_modes', public.format_var_modes(v_series));
  end if;

  -- 書き方の指示（見本で足すもの。前の「口調の指示」を含む）: 文字の配列、8 個まで、1 つ 1〜100 字（表の check と同じ）
  if not public.auto_instructions_valid(coalesce(p_instructions, '[]'::jsonb)) then
    raise exception 'invalid instructions' using errcode = '22023', hint = 'auto_instructions_invalid';
  end if;

  -- 自動の回の画像の設定（docs/design/auto-sample-image.md の 2.。表の check と同じ auto_image_valid）。
  -- 画像を選ぶなら、AI の画像の注意を読んだ印が要る（ジョブは印のない人の画像を作らない）
  if not public.auto_image_valid(p_kind, coalesce(p_image, '{}'::jsonb)) then
    raise exception 'invalid image' using errcode = '22023', hint = 'auto_image_invalid';
  end if;
  if coalesce(p_image, '{}'::jsonb) <> '{}'::jsonb and not exists (select 1 from public.ai_image_notices n where n.owner_id = v_uid) then
    raise exception 'ai image notice missing' using errcode = '22023', hint = 'ai_image_notice_missing';
  end if;

  if p_plan_id is null then
    -- 1 プロジェクト 10 件まで。同時に作っても超えないよう、プロジェクトの行を押さえてから数える
    perform 1 from public.projects p where p.id = p_project_id for update;
    if (select count(*) from public.auto_plans a where a.project_id = p_project_id) >= 10 then
      raise exception 'auto_plans limit' using errcode = 'P0001', hint = 'auto_plans_limit';
    end if;
    insert into public.auto_plans (owner_id, project_id, name, kind, materials, targets, x_link, schedule, instructions, image, lead_hours, consented_at, consent_version)
    values (v_uid, p_project_id, btrim(p_name), p_kind, v_materials, p_targets, p_x_link, p_schedule, public.auto_instructions_clean(p_instructions), coalesce(p_image, '{}'::jsonb), p_lead_hours, now(), v_version)
    returning id into v_id;
  else
    -- フォーマットの変数が変わって止めた回し方（format_changed）は、決め直して保存したら動かし直す
    select a.stop_reason into v_prev_stop from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid and a.project_id = p_project_id;
    update public.auto_plans
       set name = btrim(p_name), kind = p_kind, materials = v_materials, targets = p_targets, x_link = p_x_link,
           schedule = p_schedule, instructions = public.auto_instructions_clean(p_instructions), image = coalesce(p_image, '{}'::jsonb), lead_hours = p_lead_hours,
           consented_at = now(), consent_version = v_version, updated_at = now(),
           status = case when stop_reason = 'format_changed' then 'active' else status end,
           fail_streak = case when stop_reason = 'format_changed' then 0 else fail_streak end,
           resumed_at = case when stop_reason = 'format_changed' then now() else resumed_at end,
           stop_notified_at = case when stop_reason = 'format_changed' then null else stop_notified_at end,
           stop_reason = case when stop_reason = 'format_changed' then null else stop_reason end
     where id = p_plan_id and owner_id = v_uid and project_id = p_project_id
     returning id into v_id;
    if v_id is null then
      raise exception 'plan not found' using errcode = 'P0002';
    end if;
    delete from public.auto_runs r where r.plan_id = v_id and r.status = 'waiting';
    -- 止めたときに取り消した、まだ来ていない回は作り直す（set_auto_plan_status の再開と同じ）
    if v_prev_stop = 'format_changed' then
      delete from public.auto_runs r where r.plan_id = v_id and r.status = 'canceled' and r.reason = 'plan_paused' and r.due_at > now() and r.post_id is null;
    end if;
  end if;
  return v_id;
end;
$function$;
revoke all on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean, jsonb) to authenticated;
