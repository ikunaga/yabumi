-- 自動の回の画像（docs/design/auto-sample-image.md の 2.〜5.。2026-11-19 オーナーが Q3・Q5・Q6 をおすすめで了承。PM が DB の案を了承）
-- 1. auto_plans.image: 自動の回の画像の設定（{} は画像なし）。形は auto_image_valid（表の check と save_auto_plan で同じ）
-- 2. save_auto_plan に p_image（既定 {}）を足す（20261119100000 の新しい形を作り直す。古い形 p_tone の薄い関数は、11 個の引数を順に渡すので、既定のあるこの形に当たる）
-- 3. AI の画像の自動の投稿の分の枠: ai_image_jobs.auto、ai_image_quota・reserve_ai_images に p_auto（既定 false。今のアプリは手でつくる分のまま）
--    自動の分は 1 人 月 31 枚（登録 7 日まで 10 枚）・全体 月 $3・1 日 20 回。手でつくる分は今のまま（20 枚・3 枚・$6.66・20 回）
-- 4. reserve_ai_usage に用途 auto_post_scene（自動の回の画像の場面を Claude が書く。自動の投稿の枠）
-- 5. auto_runs.reason に image_failed（画像をつくれなかった回を下書きに回した）
-- 6. auto_samples.image: 見本でつくった画像（置き場所と ai_image_jobs の id）

-- ===== 1. 画像の設定 =====
-- source: format（フォーマットの画像の設定。シリーズだけ）/ ai（本文から AI が場面を書く）。style: photo / illustration（商品の紹介はイラストだけ。
-- 実物と違う商品を本物の写真のように見せないため）。size: auto（送り先に合わせる）/ portrait / square / landscape。
-- headline: none / format（フォーマットの見出し。source が format のときだけ）/ ai（AI が文といっしょに書く。④ で描く）
create function public.auto_image_valid(p_kind text, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p = '{}'::jsonb or (
    jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('source', 'style', 'size', 'headline'))
    and (select count(*) from jsonb_object_keys(p)) = 4
    and p->>'source' in ('format', 'ai')
    and p->>'style' in ('photo', 'illustration')
    and p->>'size' in ('auto', 'portrait', 'square', 'landscape')
    and p->>'headline' in ('none', 'format', 'ai')
    and (p->>'source' <> 'format' or p_kind = 'series')
    and (p->>'headline' <> 'format' or p->>'source' = 'format')
    and (p_kind <> 'product' or p->>'style' = 'illustration')
  );
$$;
revoke all on function public.auto_image_valid(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.auto_image_valid(text, jsonb) to authenticated, service_role;

alter table public.auto_plans add column image jsonb not null default '{}'::jsonb;
alter table public.auto_plans add constraint auto_plans_image check (public.auto_image_valid(kind, image));
comment on column public.auto_plans.image is '自動の回の画像の設定（{} は画像なし。docs/design/auto-sample-image.md の 2.）。形は auto_image_valid';

-- ===== 2. 回し方を作る・直す（p_image を足す） =====
drop function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean);
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
    values (v_uid, p_project_id, btrim(p_name), p_kind, coalesce(p_materials, '{}'::jsonb), p_targets, p_x_link, p_schedule, public.auto_instructions_clean(p_instructions), coalesce(p_image, '{}'::jsonb), p_lead_hours, now(), v_version)
    returning id into v_id;
  else
    update public.auto_plans
       set name = btrim(p_name), kind = p_kind, materials = coalesce(p_materials, '{}'::jsonb), targets = p_targets, x_link = p_x_link,
           schedule = p_schedule, instructions = public.auto_instructions_clean(p_instructions), image = coalesce(p_image, '{}'::jsonb), lead_hours = p_lead_hours,
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
revoke all on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, jsonb, integer, boolean, jsonb) to authenticated;

-- ===== 3. AI の画像の自動の投稿の分の枠 =====
alter table public.ai_image_jobs add column auto boolean not null default false;
comment on column public.ai_image_jobs.auto is '自動の投稿の画像か（手でつくる分と別の枠で数える。docs/design/auto-sample-image.md の Q6）。予約の関数だけが書く';

drop function public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid, timestamptz);
drop function public.ai_image_quota(uuid, timestamptz, uuid);

-- p_auto: 自動の投稿の分の枠で数える（既定は手でつくる分。今のアプリは渡さない）
create function public.ai_image_quota(p_owner_id uuid, p_as_of timestamptz default null, p_scope_owner uuid default null, p_auto boolean default false)
returns table (
  user_month_images integer,
  user_monthly_limit integer,
  new_until timestamptz,
  global_month_usd numeric,
  new_users_month_usd numeric,
  attempts_today integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- 手でつくる分（4.25 の ②）と、自動の投稿の分（docs/design/auto-sample-image.md の Q6。2026-11-19 オーナーが了承）は別に数える
  c_user_monthly_images constant integer := case when p_auto then 31 else 20 end;
  c_new_user_monthly_images constant integer := case when p_auto then 10 else 3 end;
  c_new_user_days constant interval := interval '7 days';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_registered timestamptz;
begin
  select u.created_at into v_registered from auth.users u where u.id = p_owner_id;
  if v_registered is null then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  return query
  select
    (select coalesce(sum(j.images), 0)::integer from public.ai_image_jobs j
      where j.owner_id = p_owner_id and j.created_at >= v_month_start and j.status <> 'failed' and j.auto = p_auto),
    case when v_registered + c_new_user_days > coalesce(p_as_of, now()) then c_new_user_monthly_images else c_user_monthly_images end,
    case when v_registered + c_new_user_days > coalesce(p_as_of, now()) then v_registered + c_new_user_days else null end,
    (select coalesce(sum(j.cost_usd), 0) from public.ai_image_jobs j
      where j.created_at >= v_month_start and j.status <> 'failed' and j.auto = p_auto and (p_scope_owner is null or j.owner_id = p_scope_owner)),
    (select coalesce(sum(j.cost_usd), 0) from public.ai_image_jobs j
      where j.created_at >= v_month_start and j.status <> 'failed' and j.auto = p_auto and j.by_new_user
        and (p_scope_owner is null or j.owner_id = p_scope_owner)),
    (select count(*)::integer from public.ai_image_jobs j where j.owner_id = p_owner_id and j.created_at >= v_day_start and j.auto = p_auto);
end;
$$;
revoke all on function public.ai_image_quota(uuid, timestamptz, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.ai_image_quota(uuid, timestamptz, uuid, boolean) to service_role;

create function public.reserve_ai_images(
  p_owner_id uuid,
  p_project_id uuid,
  p_model text,
  p_images integer,
  p_cost_usd numeric,
  p_scope_owner uuid default null,
  p_as_of timestamptz default null,
  p_auto boolean default false
)
returns table (
  job_id uuid,
  status text,
  user_month_images integer,
  user_monthly_limit integer,
  new_until timestamptz,
  global_month_usd numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 全体の月の上限: 手でつくる分 $6.66、自動の投稿の分 $3（別に数える。docs/architecture.md の費用）
  c_global_monthly_usd constant numeric := case when p_auto then 3 else 6.66 end;
  c_new_users_share constant numeric := 1.0 / 3;
  c_daily_attempts constant integer := 20;
  q record;
  v_id uuid;
begin
  if p_images < 1 or p_images > 4 or p_cost_usd is null or p_cost_usd <= 0 then
    raise exception 'images out of range' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_image_jobs'));
  select * into q from public.ai_image_quota(p_owner_id, p_as_of, p_scope_owner, p_auto);
  -- 試みの回数（作れなかった回も数える）
  if q.attempts_today >= c_daily_attempts then
    return query select null::uuid, 'attempt_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  if q.global_month_usd + p_cost_usd > c_global_monthly_usd then
    return query select null::uuid, 'global_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  -- 登録 7 日以内の人たち全体の枠（全体の 3 分の 1）
  if q.new_until is not null and q.new_users_month_usd + p_cost_usd > c_global_monthly_usd * c_new_users_share then
    return query select null::uuid, 'new_users_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  if q.user_month_images + p_images > q.user_monthly_limit then
    return query select null::uuid, 'user_limit'::text, q.user_month_images, q.user_monthly_limit, q.new_until, q.global_month_usd;
    return;
  end if;
  insert into public.ai_image_jobs (owner_id, project_id, model, images, cost_usd, by_new_user, auto)
  values (p_owner_id, p_project_id, p_model, p_images, p_cost_usd, q.new_until is not null, p_auto)
  returning id into v_id;
  return query select v_id, 'ok'::text, q.user_month_images + p_images, q.user_monthly_limit, q.new_until, q.global_month_usd + p_cost_usd;
end;
$$;
revoke all on function public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid, timestamptz, boolean) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid, timestamptz, boolean) to service_role;

-- ===== 4. AI の予約（自動の回の画像の場面 auto_post_scene） =====
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
  v_auto boolean := p_purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene');
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
    when 'auto_post_scene' then 0.15  -- 自動の回の画像の場面（写真・絵の場面の案と同じ呼び出し。4,000）
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
     and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene')) = v_auto
     and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
  select coalesce(sum(a.cost_usd) filter (where a.created_at >= v_month_start), 0),
         (count(*) filter (where a.created_at >= v_day_start))::integer,
         (count(*) filter (where a.created_at >= v_day_start and a.purpose = 'auto_post'))::integer
    into v_user, v_today, v_auto_today
    from public.ai_usage a
   where a.owner_id = p_owner_id
     and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene')) = v_auto
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
       and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene')) = v_auto
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

comment on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) is '文章の AI を呼ぶ前に、上限（関数の中で固定）を確かめて見込みの費用で予約する。見込みは用途ごとの下限と 1 回の上限（$1）で挟む。自動の投稿（auto_post・auto_post_check・auto_post_sample・auto_post_scene）は別の枠で数え、運営者が止めている人は断る。見本（auto_post_sample）は 1 人 1 日 5 回まで。断った分は記録しない';
revoke all on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) to service_role;

-- ===== 5. 画像をつくれなかった回 =====
alter table public.auto_runs drop constraint auto_runs_reason_check;
alter table public.auto_runs add constraint auto_runs_reason_check check (reason is null or reason in (
  'no_material', 'cannot_write', 'check_failed', 'similar', 'made_up', 'avoid', 'too_long', 'ai_limit', 'daily_limit',
  'disconnected', 'error', 'user_skipped', 'plan_paused', 'operator_hold', 'image_failed'
));

-- ===== 6. 見本の画像 =====
-- {"path": "<持ち主>/gen/<乱数>.jpg", "job_id": "<ai_image_jobs の id>", "width": 1080, "height": 1350, "alt": "…"}。候補の置き場所なので 1 日で片付けの対象になる
alter table public.auto_samples add column image jsonb check (image is null or (jsonb_typeof(image) = 'object' and octet_length(image::text) <= 2000));
comment on column public.auto_samples.image is '見本でつくった画像（置き場所と ai_image_jobs の id）。最初の回にするとき、その回に添える';
