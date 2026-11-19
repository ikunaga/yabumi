-- 自動の投稿の見本を指示で直す（docs/design/auto-sample-image.md の 1.。2026-11-19 オーナーが Q1・Q2・Q8 をおすすめで了承。PM の依頼）
-- 1. auto_plans.instructions: 書き方の指示の一覧（文字の配列、8 個まで、1 つ 1〜100 字）。前の「口調の指示」（tone）は 1 つ目に移す。
--    tone の列は、本番で db push から git push までの間に古いアプリが使うので、このマイグレーションでは消さない（使わないだけ。次のマイグレーションで消す。docs/deploy.md の TODO）
-- 2. save_auto_plan: p_instructions（jsonb）の形を足す。古い形（p_tone text）は、新しい形を呼ぶだけの薄い関数にして次のデプロイまで残す
--    （PostgREST は引数の名前で区別する。権限は今と同じ。消すのは次のマイグレーション）
-- 3. set_auto_plan_instructions: 回し方の画面の見本から、指示だけを直す（同意の取り直し・まだ作っていない回の作り直しはしない）
-- 4. reserve_ai_usage: 用途 auto_post_sample（見本を作る）を足す。自動の投稿の枠で数え、1 人 1 日 5 回まで（ジョブの回の 1 日 10 回とは別）
-- 5. auto_samples: 作った見本（1 日だけ置く）。「この見本を最初の回にする」と「同じ材料で作り直す」に使う。サーバーだけが読み書きする

-- ===== 1. 書き方の指示 =====
-- 形を確かめる（表の check と関数で同じものを使う）
create function public.auto_instructions_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 8
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 1 and 100 or (e #>> '{}') ~ '[[:cntrl:]]'
     );
$$;
revoke all on function public.auto_instructions_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.auto_instructions_valid(jsonb) to authenticated, service_role;

-- 前後の空白を除き、同じものを 1 つにする（順は残す）
create function public.auto_instructions_clean(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(t.v) order by t.first), '[]'::jsonb)
    from (select btrim(e #>> '{}') as v, min(o) as first
            from jsonb_array_elements(coalesce(p, '[]'::jsonb)) with ordinality as x(e, o)
           group by btrim(e #>> '{}')) t;
$$;
revoke all on function public.auto_instructions_clean(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.auto_instructions_clean(jsonb) to authenticated, service_role;

alter table public.auto_plans add column instructions jsonb not null default '[]'::jsonb;
update public.auto_plans set instructions = jsonb_build_array(btrim(tone)) where btrim(tone) <> '';
alter table public.auto_plans add constraint auto_plans_instructions check (public.auto_instructions_valid(instructions));
comment on column public.auto_plans.instructions is '書き方の指示の一覧（毎回の AI の指示に入れる。8 個まで・1 つ 100 字まで）。前の「口調の指示」（tone）はここの 1 つ目に移した';

-- ===== 2. 回し方を作る・直す（p_instructions の形） =====
comment on column public.auto_plans.tone is '使わない（instructions に移した）。古いアプリが残っている間だけ置く。次のマイグレーションで消す（docs/deploy.md の TODO）';
create function public.save_auto_plan(
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

  -- 書き方の指示（見本で足すもの。前の「口調の指示」を含む）: 文字の配列、8 個まで、1 つ 1〜100 字（表の check と同じ）
  if not public.auto_instructions_valid(coalesce(p_instructions, '[]'::jsonb)) then
    raise exception 'invalid instructions' using errcode = '22023', hint = 'auto_instructions_invalid';
  end if;

  if p_plan_id is null then
    -- 1 プロジェクト 10 件まで。同時に作っても超えないよう、プロジェクトの行を押さえてから数える
    perform 1 from public.projects p where p.id = p_project_id for update;
    if (select count(*) from public.auto_plans a where a.project_id = p_project_id) >= 10 then
      raise exception 'auto_plans limit' using errcode = 'P0001', hint = 'auto_plans_limit';
    end if;
    insert into public.auto_plans (owner_id, project_id, name, kind, materials, targets, x_link, schedule, instructions, lead_hours, consented_at, consent_version)
    values (v_uid, p_project_id, btrim(p_name), p_kind, coalesce(p_materials, '{}'::jsonb), p_targets, p_x_link, p_schedule, public.auto_instructions_clean(p_instructions), p_lead_hours, now(), v_version)
    returning id into v_id;
  else
    update public.auto_plans
       set name = btrim(p_name), kind = p_kind, materials = coalesce(p_materials, '{}'::jsonb), targets = p_targets, x_link = p_x_link,
           schedule = p_schedule, instructions = public.auto_instructions_clean(p_instructions), lead_hours = p_lead_hours,
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
revoke all on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean) to authenticated;

-- 古い形（p_tone）: 次のデプロイまで残す（db push のあと、git push までの間に古いアプリが呼ぶため）。口調の指示を、指示の一覧の 1 つにして新しい形を呼ぶだけ。
-- 権限は今と同じ（authenticated だけ）。次のマイグレーションで消す（docs/deploy.md の TODO）
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
begin
  return public.save_auto_plan(
    p_plan_id, p_project_id, p_name, p_kind, p_materials, p_targets, p_x_link, p_schedule,
    case when btrim(coalesce(p_tone, '')) = '' then '[]'::jsonb else jsonb_build_array(btrim(p_tone)) end,
    p_lead_hours, p_consent
  );
end;
$$;
comment on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text, integer, boolean) is '古い形（口調の指示 p_tone）。新しい形（p_instructions）を呼ぶだけ。次のデプロイのあとのマイグレーションで消す';
revoke all on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text, integer, boolean) to authenticated;

-- ===== 3. 指示だけを直す（回し方の画面の見本から） =====
-- 同意の取り直しはしない（送るかどうか・どこに・いつは変わらない）。まだ作っていない回も消さない（作るときに今の指示で作る）。
-- 運営者が止めている人・運営者が止めたプロジェクトは断る（save_auto_plan と同じ）
create function public.set_auto_plan_instructions(p_plan_id uuid, p_instructions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project uuid;
  v_clean jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if public.auto_post_held(v_uid) then
    raise exception 'auto post held' using errcode = '42501', hint = 'auto_post_hold';
  end if;
  if not public.auto_instructions_valid(coalesce(p_instructions, '[]'::jsonb)) then
    raise exception 'invalid instructions' using errcode = '22023', hint = 'auto_instructions_invalid';
  end if;
  select a.project_id into v_project from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid for update;
  if v_project is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.auto_plans a where a.project_id = v_project and a.owner_id = v_uid and a.stop_reason = 'operator') then
    raise exception 'stopped by operator' using errcode = '42501', hint = 'auto_plan_operator_stop';
  end if;
  v_clean := public.auto_instructions_clean(p_instructions);
  update public.auto_plans set instructions = v_clean, updated_at = now() where id = p_plan_id and owner_id = v_uid;
  return v_clean;
end;
$$;
revoke all on function public.set_auto_plan_instructions(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_auto_plan_instructions(uuid, jsonb) to authenticated;

-- ===== 4. AI の予約（見本を作る auto_post_sample） =====
create or replace function public.reserve_ai_usage(
  p_owner_id uuid,
  p_purpose text,
  p_cost_usd numeric,
  p_thread_id uuid default null,
  p_scope_owner uuid default null,
  p_as_of timestamptz default null
)
returns table (usage_id uuid, status text, global_month_usd numeric, new_until date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_user_monthly_usd constant numeric := 3;
  c_global_monthly_usd constant numeric := 10;
  c_user_daily_turns constant integer := 60;
  c_voice_memo_daily_runs constant integer := 3;
  c_post_format_daily_runs constant integer := 10;
  c_post_format_round_daily_runs constant integer := 20;
  -- 自動の投稿の枠（docs/design/auto-post.md の A4。2026-11-16 オーナーが (a) に決めた）。ふだんの枠（上の 3 つ）とは別に数える
  c_auto_user_monthly_usd constant numeric := 3;
  c_auto_global_monthly_usd constant numeric := 5;
  c_auto_user_daily_runs constant integer := 10;
  -- 見本を作る（auto_post_sample）は 1 人 1 日 5 回まで。ジョブの回の 10 回とは別に数える（docs/design/auto-sample-image.md の 1.4）
  c_auto_sample_daily_runs constant integer := 5;
  c_new_days constant interval := interval '7 days';
  -- 1 回の呼び出しで予約できる見込みの上限（src/lib/ai/budget.ts の AI_MAX_RESERVATION_USD と同じ値）
  c_max_reservation_usd constant numeric := 1;
  v_floor numeric;
  v_cost numeric;
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_day_start timestamptz := date_trunc('day', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_created timestamptz;
  v_new boolean;
  v_new_until date;
  v_global numeric;
  v_new_global numeric;
  v_user numeric;
  v_today integer;
  v_auto boolean := p_purpose in ('auto_post', 'auto_post_check', 'auto_post_sample');
  v_auto_today integer;
  -- この用途の枠（自動の投稿か、ふだんか）
  v_user_cap numeric := case when v_auto then c_auto_user_monthly_usd else c_user_monthly_usd end;
  v_global_cap numeric := case when v_auto then c_auto_global_monthly_usd else c_global_monthly_usd end;
  v_id uuid;
begin
  -- 用途ごとの見込みの下限（米ドル）。その用途で使う呼び出しのうち、出力の上限がいちばん小さいものの最大の額
  -- （送る中身が空でも、足される分 8,000 トークン × 6.25 ドル と出力の上限 × 25 ドル / 100 万トークン。src/lib/ai/budget.ts の reserveEstimateUsd と同じ数え方。
  -- tests/ai-budget.test.ts で、アプリの見込みがこれを下回らないことを確かめる）。知らない用途は断る
  v_floor := case p_purpose
    when 'account_plan' then 0.25     -- 設計の相棒（出力 8,000）
    when 'consult' then 0.15          -- 相談（8,000）と縮める（4,000）
    when 'app_description' then 0.10  -- 読むファイルを選ぶ（2,000）と紹介文（4,000）
    when 'post_ideas' then 0.15       -- ネタ（16,000）と縮める（4,000）
    when 'ai_check' then 0.15         -- AI っぽさチェック（4,000）
    when 'image_brief' then 0.15      -- 画像の文字の案（4,000）
    when 'image_photo_idea' then 0.15 -- 写真・絵の場面の案（4,000）
    when 'tidy_draft' then 0.15       -- 投稿に整える（8,000）と縮める（4,000）
    when 'voice_memo' then 0.15       -- 書き方（文調のメモ）を読み取る（4,000）
    when 'post_format' then 0.12      -- 投稿のフォーマットの案を AI とつくる（3,000）
    when 'post_format_round' then 0.11 -- シリーズの次の回の案（2,500）
    when 'auto_post' then 0.13        -- 自動の投稿の文を作る（3,200）・縮める・直す
    when 'auto_post_check' then 0.15  -- 自動の回の AI っぽさチェック（4,000。ai_check と同じ）
    when 'auto_post_sample' then 0.13 -- 見本を作る（auto_post と同じ呼び出し。3,200）・縮める
  end;
  if p_owner_id is null or v_floor is null or p_cost_usd is null or p_cost_usd <= 0 or p_cost_usd > c_max_reservation_usd then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  -- 運営者が利用者ごとに止めている間は、自動の投稿の AI を断る（ジョブも「見本を作る」もここを通る）
  if v_auto and public.auto_post_held(p_owner_id) then
    return query select null::uuid, 'auto_post_hold'::text, 0::numeric, null::date;
    return;
  end if;
  -- 渡された見込みが下限より小さければ、下限で予約する
  v_cost := greatest(p_cost_usd, v_floor);
  select u.created_at into v_created from auth.users u where u.id = p_owner_id;
  if v_created is null then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  v_new := v_created + c_new_days > coalesce(p_as_of, v_now);
  v_new_until := ((v_created + c_new_days) at time zone 'Asia/Tokyo')::date;

  perform pg_advisory_xact_lock(hashtext('ai_usage'));
  -- ふだんの用途と自動の投稿の用途は、別々の枠で数える（v_auto の側だけを合計する）
  select coalesce(sum(a.cost_usd), 0) into v_global
    from public.ai_usage a
   where a.created_at >= v_month_start
     and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample')) = v_auto
     and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
  select coalesce(sum(a.cost_usd) filter (where a.created_at >= v_month_start), 0),
         (count(*) filter (where a.created_at >= v_day_start))::integer,
         (count(*) filter (where a.created_at >= v_day_start and a.purpose = 'auto_post'))::integer
    into v_user, v_today, v_auto_today
    from public.ai_usage a
   where a.owner_id = p_owner_id
     and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample')) = v_auto
     and a.created_at >= least(v_month_start, v_day_start);

  if v_global + v_cost > v_global_cap then
    return query select null::uuid, 'global_limit'::text, v_global, null::date;
    return;
  end if;
  if v_new then
    -- 今月、新しい人のときに予約した行（退会しても残る）
    select coalesce(sum(a.cost_usd), 0) into v_new_global
      from public.ai_usage a
     where a.created_at >= v_month_start
       and a.by_new_user
       and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample')) = v_auto
       and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
    if v_new_global + v_cost > v_global_cap / 3 then
      return query select null::uuid, 'new_global_limit'::text, v_global, v_new_until;
      return;
    end if;
    if v_user + v_cost > v_user_cap / 3 then
      return query select null::uuid, 'new_user_limit'::text, v_global, v_new_until;
      return;
    end if;
  elsif v_user + v_cost > v_user_cap then
    return query select null::uuid, 'user_limit'::text, v_global, null::date;
    return;
  end if;
  -- 1 日の回数: ふだんは往復 60 回、自動の投稿は作る（auto_post）回数で 10 回（チェックは数えない。作った回ごとに 1〜2 回なので）
  if (not v_auto and v_today >= c_user_daily_turns) or (p_purpose = 'auto_post' and v_auto_today >= c_auto_user_daily_runs) then
    return query select null::uuid, 'daily_limit'::text, v_global, null::date;
    return;
  end if;
  -- 見本を作る（auto_post_sample）は 1 人 1 日 5 回まで（同じ lock の中で数える。src/lib/auto-post/schema.ts の AUTO_SAMPLE_DAILY_RUNS と同じ値）
  if p_purpose = 'auto_post_sample' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'auto_post_sample' and a.created_at >= v_day_start
  ) >= c_auto_sample_daily_runs then
    return query select null::uuid, 'auto_sample_limit'::text, v_global, null::date;
    return;
  end if;
  -- 書き方の読み取り（voice_memo）は 1 人 1 日 3 回まで。予約と同じ lock の中で数えるので、同時に押しても超えない
  -- （利用者が消せない ai_usage で数える。src/lib/plan/voice-rules.ts の VOICE_MEMO_DAILY_RUNS と同じ値）
  if p_purpose = 'voice_memo' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'voice_memo' and a.created_at >= v_day_start
  ) >= c_voice_memo_daily_runs then
    return query select null::uuid, 'voice_memo_limit'::text, v_global, null::date;
    return;
  end if;
  -- 投稿のフォーマットを AI とつくる（post_format）は 1 人 1 日 10 回まで（voice_memo と同じ数え方。src/lib/post-formats/schema.ts の POST_FORMAT_DAILY_RUNS と同じ値）
  if p_purpose = 'post_format' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'post_format' and a.created_at >= v_day_start
  ) >= c_post_format_daily_runs then
    return query select null::uuid, 'post_format_limit'::text, v_global, null::date;
    return;
  end if;
  -- シリーズの次の回の案（post_format_round）は 1 人 1 日 20 回まで（同じ数え方。src/lib/post-formats/series.ts の SERIES_DAILY_RUNS と同じ値）
  if p_purpose = 'post_format_round' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'post_format_round' and a.created_at >= v_day_start
  ) >= c_post_format_round_daily_runs then
    return query select null::uuid, 'post_format_round_limit'::text, v_global, null::date;
    return;
  end if;

  insert into public.ai_usage (owner_id, thread_id, purpose, model, cost_usd, status, by_new_user)
  values (p_owner_id, p_thread_id, p_purpose, 'reserved', v_cost, 'reserved', v_new)
  returning id into v_id;
  return query select v_id, 'ok'::text, v_global + v_cost, case when v_new then v_new_until end;
end;
$$;

comment on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) is '文章の AI を呼ぶ前に、上限（関数の中で固定）を確かめて見込みの費用で予約する。見込みは用途ごとの下限と 1 回の上限（$1）で挟む。自動の投稿（auto_post・auto_post_check・auto_post_sample）は別の枠で数え、運営者が止めている人は断る。見本（auto_post_sample）は 1 人 1 日 5 回まで。断った分は記録しない';
revoke all on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) to service_role;

-- ===== 5. 作った見本（1 日だけ置く） =====
-- 見本は回し方を保存する前にも作る（plan_id は直すときだけ）。中身はサーバーが作ったものだけを入れ、画面からは書けない・読めない
-- （画面には作ったときの返事で見せる）。「この見本を最初の回にする」では、ここから投稿を作る（画面から文を受け取らない）。
-- settings: 作ったときの設定（使い道・材料・送る SNS と送り方・指示）。最初の回にするとき、保存した設定と同じかを確かめる
create table public.auto_samples (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  plan_id uuid references public.auto_plans (id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 8000),
  -- 選んだ材料（同じ材料で作り直すとき・最初の回にするときに使う）
  material jsonb not null check (jsonb_typeof(material) = 'object' and octet_length(material::text) <= 20000),
  -- SNS ごとの文とタグ。確かめで引っかかったら hold に種類と理由（そのときは最初の回にできない）
  texts jsonb not null check (jsonb_typeof(texts) = 'object' and octet_length(texts::text) <= 40000),
  tags jsonb not null default '{}' check (jsonb_typeof(tags) = 'object' and octet_length(tags::text) <= 4000),
  hold jsonb check (hold is null or (jsonb_typeof(hold) = 'object' and octet_length(hold::text) <= 1000)),
  created_at timestamptz not null default now()
);
comment on table public.auto_samples is '自動の投稿の見本（docs/design/auto-sample-image.md の 1.）。サーバーだけが読み書きする。1 日で消す（自動の投稿のジョブ）';
create index auto_samples_owner_idx on public.auto_samples (owner_id, created_at);
create index auto_samples_created_idx on public.auto_samples (created_at);
alter table public.auto_samples enable row level security;
-- 利用者のポリシー・grant は作らない（読み書きはサーバーの権限だけ）
revoke all on public.auto_samples from public, anon, authenticated;
grant select, insert, update, delete on public.auto_samples to service_role;
