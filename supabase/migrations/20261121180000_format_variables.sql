-- フォーマットの「変数」（2026-11-21 オーナーの決定。docs/design/format-series.md の 1）。
-- 前の形（series の answer = 本文に出さない答え、slots = AI が埋める空欄、型の文のほかの空欄 = 自分で入れる）を、変数の一覧 1 つにまとめる。
--   series = {"vars": [{"name", "mode": "ai" | "hand", "instruction", "unique"}]}
--   ・ai: 毎回 AI が考える（instruction が AI への指示）。hand: 投稿をつくるときに自分で入れる
--   ・unique: 前の投稿と重ならないようにする（前の「答え」はこれが付いた AI の変数）
--   ・本文・画像の設定（絵の説明・見出し・小さい文）に {名前} と書くと、そこに入る。どこにも書かない変数は投稿に出ない
-- 1. post_formats.series の形の決まりを差し替え、いまの行を新しい形に移す（型の文と画像の設定の {名前} は、すべて変数として持つ）
-- 2. post_format_rounds.answer を values（変数の名前 → 言葉）に移して、列を削除する
-- 3. 自動投稿: 「自分で入れる」変数の決め方を auto_plans.materials に持つ（format_vars）。保存したときの変数の作り方（format_var_modes）は
--    save_auto_plan が決める。フォーマットの変数が変わったら、ジョブが止めて知らせる（stop_reason = format_changed）
-- 預かる情報・送り先・使い道は変わらない（docs/legal.md に ① として記録）

-- ===== 1. フォーマットの変数 =====
create function public.format_series_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and (p - 'vars') = '{}'::jsonb
    and coalesce(jsonb_typeof(p->'vars'), 'array') = 'array'
    and coalesce(jsonb_array_length(p->'vars'), 0) <= 12
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p->'vars', '[]'::jsonb)) v
       where jsonb_typeof(v) <> 'object'
          or (v - array['name', 'mode', 'instruction', 'unique']::text[]) <> '{}'::jsonb
          or coalesce(jsonb_typeof(v->'name'), '') <> 'string'
          or not coalesce(v->>'name' ~ '^[^{}\n\r]{1,12}$', false)
          or btrim(v->>'name') <> v->>'name'
          or coalesce(v->>'mode', '') not in ('ai', 'hand')
          or coalesce(jsonb_typeof(v->'instruction'), '') <> 'string'
          or char_length(v->>'instruction') > 60
          or coalesce(jsonb_typeof(v->'unique'), '') <> 'boolean'
    )
    -- AI が考える変数は 8 個まで。同じ名前は 1 つ
    and (select count(*) from jsonb_array_elements(coalesce(p->'vars', '[]'::jsonb)) v where v->>'mode' = 'ai') <= 8
    and (select count(distinct v->>'name') from jsonb_array_elements(coalesce(p->'vars', '[]'::jsonb)) v) = coalesce(jsonb_array_length(p->'vars'), 0)
    and octet_length(p::text) <= 6000;
$$;
revoke all on function public.format_series_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.format_series_valid(jsonb) to authenticated, service_role;

alter table public.post_formats drop constraint post_formats_series_check;

-- いまの行を移す。並びは、答え → 型の文と画像の設定に出てくる順 → どこにも書いていない AI の空欄
do $$
declare
  f record;
  v_answer text;
  v_has_round_answer boolean;
begin
  for f in select id, body, image, series from public.post_formats loop
    v_answer := case when jsonb_typeof(f.series->'answer') = 'object' then f.series->'answer'->>'name' end;
    -- 答えの決まりがないシリーズでも、AI は回ごとに「答え」（何についての回か）を書いて、重なりの判定に使っていた。
    -- その記録があれば、同じ働きの変数「答え」を持たせる（名前がほかの空欄と重なるときは持たせない）
    v_has_round_answer := v_answer is null
      and coalesce(f.series->'slots', '{}'::jsonb) <> '{}'::jsonb
      and not (coalesce(f.series->'slots', '{}'::jsonb) ? '答え')
      and position('{答え}' in f.body) = 0
      and exists (select 1 from public.post_format_rounds r where r.format_id = f.id and btrim(r.answer) <> '');
    update public.post_formats p set series = jsonb_build_object('vars', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'mode', x.mode, 'instruction', x.instruction, 'unique', x.uniq) order by x.ord)
        from (
          select distinct on (c.name) c.name, c.ord,
                 case when c.name = v_answer or (v_has_round_answer and c.name = '答え') or f.series->'slots' ? c.name then 'ai' else 'hand' end as mode,
                 case
                   when c.name = v_answer then coalesce(f.series->'answer'->>'instruction', '')
                   when v_has_round_answer and c.name = '答え' then 'この回が何についてか。作品やものの名前を 1 つ'
                   when f.series->'slots' ? c.name then coalesce(f.series->'slots'->>c.name, '')
                   else ''
                 end as instruction,
                 coalesce(c.name = v_answer, false) or (v_has_round_answer and c.name = '答え') as uniq
            from (
              select v_answer as name, 0 as ord where v_answer is not null
              union all
              select '答え', 1 where v_has_round_answer
              union all
              select btrim(m.m[1]), 1000 + m.n
                from regexp_matches(
                       f.body || E'\n' || coalesce(f.image->>'prompt', '') || E'\n' || coalesce(f.image->>'headline', '') || E'\n' || coalesce(f.image->>'label', ''),
                       '\{([^{}\n]*)\}', 'g') with ordinality as m(m, n)
               where btrim(m.m[1]) <> ''
              union all
              select s.key, 100000 + s.n from jsonb_each_text(coalesce(f.series->'slots', '{}'::jsonb)) with ordinality as s(key, value, n)
            ) c
           order by c.name, c.ord
        ) x
    ), '[]'::jsonb))
    where p.id = f.id;

    -- 記録の答えを、答えの変数の言葉として values に移す
    if v_answer is not null or v_has_round_answer then
      update public.post_format_rounds r
         set "values" = r."values" || jsonb_build_object(coalesce(v_answer, '答え'), left(btrim(r.answer), 100))
       where r.format_id = f.id and btrim(r.answer) <> '' and not (r."values" ? coalesce(v_answer, '答え'));
    end if;
  end loop;
end;
$$;

-- 変数が 1 つもないフォーマットは {} のまま持つ（前と同じく「シリーズでない」）
update public.post_formats set series = '{}'::jsonb where series = '{"vars": []}'::jsonb;

alter table public.post_formats add constraint post_formats_series_check check (public.format_series_valid(series));
comment on column public.post_formats.series is '変数の一覧 {"vars": [{"name", "mode": "ai" | "hand", "instruction", "unique"}]}。本文・画像の設定の {名前} に入る（docs/design/format-series.md の 1）';

-- ===== 2. 記録の答えの列 =====
-- 答えの言葉は values に移した（1.）。答えだけの記録（貼った回）は、変数のない古いフォーマットでは移し先がないので消える
delete from public.post_format_rounds where "values" = '{}'::jsonb;
alter table public.post_format_rounds drop constraint post_format_rounds_check;
alter table public.post_format_rounds drop column answer;
alter table public.post_format_rounds add constraint post_format_rounds_values_present check ("values" <> '{}'::jsonb);
comment on table public.post_format_rounds is 'シリーズの記録（フォーマットの回ごとの変数の言葉。1 つのフォーマットに 300 回まで、1 人 3,000 回まで）';
-- 列を削除すると、その列の grant も消える。insert できる列は前と同じ（answer を除く）
grant insert (format_id, owner_id, "values", source) on public.post_format_rounds to authenticated;

-- ===== 3. 自動投稿 =====
-- 「自分で入れる」変数の決め方（1 つ 200 字 × 12 個まで入るよう、材料の大きさの上限を上げる）
alter table public.auto_plans drop constraint auto_plans_materials_check;
alter table public.auto_plans add constraint auto_plans_materials_check check (jsonb_typeof(materials) = 'object' and octet_length(materials::text) <= 8000);

alter table public.auto_plans drop constraint auto_plans_stop_reason_check;
alter table public.auto_plans add constraint auto_plans_stop_reason_check
  check (stop_reason is null or stop_reason in ('fail_streak', 'disconnected', 'materials_out', 'operator', 'format_changed'));

-- フォーマットの変数の作り方（名前 → ai / hand）。save_auto_plan とこのマイグレーションだけが書く
create function public.format_var_modes(p_series jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(v->>'name', v->>'mode'), '{}'::jsonb) from jsonb_array_elements(coalesce(p_series->'vars', '[]'::jsonb)) v;
$$;
revoke all on function public.format_var_modes(jsonb) from public, anon, authenticated, service_role;

-- いまのシリーズの回し方は、移したあとの変数の作り方を、保存したときのものとして持つ（移したことで「要確認」にしない）。
-- 前は「自分で入れる」空欄のあるフォーマットは自動では書けなかった（cannot_write）ので、決め方（format_vars）はまだない
update public.auto_plans a
   set materials = a.materials || jsonb_build_object('format_var_modes', public.format_var_modes(f.series))
  from public.post_formats f
 where a.kind = 'series' and f.id = (a.materials->>'format_id')::uuid;

-- save_auto_plan: 20261119110000 の写しに、材料の format_vars の確かめと、format_var_modes を決めることを足す
create or replace function public.save_auto_plan(
  p_plan_id uuid,
  p_project_id uuid,
  p_name text,
  p_kind text,
  p_materials jsonb,
  p_targets jsonb,
  p_x_link text,
  p_schedule jsonb,
  p_instructions jsonb,
  p_lead_hours integer,
  p_consent boolean,
  p_image jsonb default '{}'::jsonb
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
$$;
revoke all on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean, jsonb) to authenticated;

-- set_auto_plan_status: 20261118100000 の写し。フォーマットの変数が変わって止めた回し方は、「再開する」では動かさない（設定で決め直して保存する）
create or replace function public.set_auto_plan_status(p_project_id uuid, p_plan_id uuid, p_status text, p_to_draft boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
    update public.auto_plans a set status = 'active', stop_reason = null, fail_streak = 0, updated_at = now() where a.id = any(v_plans);
    -- 止めている間に取り消した、まだ来ていない回は作り直す（ジョブが規則から足し直す）
    delete from public.auto_runs r where r.plan_id = any(v_plans) and r.status = 'canceled' and r.reason = 'plan_paused' and r.due_at > now() and r.post_id is null;
  end if;
  return array_length(v_plans, 1);
end;
$$;
revoke all on function public.set_auto_plan_status(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_auto_plan_status(uuid, uuid, text, boolean) to authenticated;
