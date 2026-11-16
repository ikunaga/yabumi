-- 自動の投稿（docs/design/auto-post.md。2026-11-16 オーナーが A1〜A8 をおすすめで了承。PM の依頼）。段階 A の土台（feat/auto-post-core）。
-- 1. auto_plans: 自動の回し方（設定）。書き込みは検証つきの関数だけ（状態・同意の日時・続けての失敗を利用者が書き換えられないように）
-- 2. auto_runs: 自動の回（1 回ごと）。サーバーだけが書く
-- 3. project_events: お知らせ・季節の材料の予定。本人が読み書きする（RLS と列の grant）
-- 4. posts.auto_run_id: 自動の回で作った投稿の印。利用者は書けない（トリガー）
-- 5. 確かめて送る（X など。4.2）: post_targets.status に awaiting_approval を足し、承認の記録 post_target_approvals を置く。
--    claim_due_targets は pending しか取り出さないので、承認の前は送られない（送信ジョブは変えない）
-- 6. 関数: save_auto_plan・set_auto_plan_status・delete_auto_plan・skip_next_auto_run・review_auto_run・approve_auto_target・decline_auto_target・
--    auto_target_previews・claim_due_auto_runs
-- 7. save_post: 確かめ待ちの配信先も、送る前の配信先として直す・外すができるようにする

-- ===== 1. 自動の回し方 =====
create table public.auto_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  kind text not null check (kind in ('series', 'product', 'notes', 'pillars', 'rerun', 'events', 'commits')),
  -- 使い道ごとの選んだもの（形は save_auto_plan と src/lib/auto-post/schema.ts で確かめる）
  materials jsonb not null default '{}' check (jsonb_typeof(materials) = 'object' and octet_length(materials::text) <= 2000),
  -- SNS ごとの送り方 {"threads": "auto", "x": "review", "note": "by_hand"}
  targets jsonb not null check (jsonb_typeof(targets) = 'object' and targets <> '{}'::jsonb),
  -- X にリンクを付けるか（URL つきは 1 本 $0.20。docs/design/auto-post.md の 1.4）
  x_link text not null default 'never' check (x_link in ('never', 'always')),
  -- くり返しの規則 {"weekdays": [2, 5], "time": "19:00", "every_weeks": 1, "start": "2026-11-16"}（曜日は ISO: 1 = 月〜7 = 日。日本時間）
  schedule jsonb not null check (jsonb_typeof(schedule) = 'object'),
  tone text not null default '' check (char_length(tone) <= 100),
  -- 送る何時間前に作るか（A1。既定 24）
  lead_hours integer not null default 24 check (lead_hours between 1 and 48),
  -- 最初の回を確かめてもらう（A3）。確かめて送ったら false
  first_review boolean not null default true,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped')),
  stop_reason text check (stop_reason is null or stop_reason in ('fail_streak', 'disconnected', 'materials_out', 'operator')),
  fail_streak integer not null default 0 check (fail_streak >= 0),
  -- 自動で送ることに同意した日時と、そのとき同意していた規約の版（どちらもサーバーが決める）
  consented_at timestamptz not null,
  consent_version date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auto_plans_stop_reason check ((status = 'stopped') = (stop_reason is not null))
);
comment on table public.auto_plans is '自動の回し方（docs/design/auto-post.md の 2.2）。書き込みは save_auto_plan などの関数とサーバーだけ';
create index auto_plans_project_idx on public.auto_plans (project_id);
create index auto_plans_owner_idx on public.auto_plans (owner_id);
alter table public.auto_plans enable row level security;
create policy "auto_plans_select_own" on public.auto_plans
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.auto_plans from anon, authenticated;
grant select on public.auto_plans to authenticated;
grant select, insert, update, delete on public.auto_plans to service_role;

-- ===== 2. 自動の回 =====
create table public.auto_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.auto_plans (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  due_at timestamptz not null,
  generate_at timestamptz not null,
  -- waiting: 作る前 / generating: 作っている / scheduled: 予約にした / review: 最初の回の確かめ待ち（A3） /
  -- held: 下書きに回した / skipped: 飛ばした / canceled: 利用者が止めた・飛ばした
  status text not null default 'waiting' check (status in ('waiting', 'generating', 'scheduled', 'review', 'held', 'skipped', 'canceled')),
  post_id uuid references public.posts (id) on delete set null,
  -- 使った材料（メモ・行き先・元の投稿・シリーズの記録の id、コミットの範囲）
  material_ref jsonb not null default '{}' check (jsonb_typeof(material_ref) = 'object' and octet_length(material_ref::text) <= 2000),
  reason text check (reason is null or reason in (
    'no_material', 'cannot_write', 'check_failed', 'similar', 'made_up', 'avoid', 'too_long', 'ai_limit', 'daily_limit',
    'disconnected', 'error', 'user_skipped', 'plan_paused'
  )),
  reason_detail text check (reason_detail is null or char_length(reason_detail) <= 200),
  attempts integer not null default 0 check (attempts >= 0),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, due_at)
);
comment on table public.auto_runs is '自動の回（docs/design/auto-post.md の 2.2）。サーバーだけが書く。13 か月で消す';
create index auto_runs_due_idx on public.auto_runs (generate_at) where status = 'waiting';
create index auto_runs_owner_idx on public.auto_runs (owner_id, due_at);
create index auto_runs_post_idx on public.auto_runs (post_id) where post_id is not null;
alter table public.auto_runs enable row level security;
create policy "auto_runs_select_own" on public.auto_runs
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.auto_runs from anon, authenticated;
grant select on public.auto_runs to authenticated;
grant select, insert, update, delete on public.auto_runs to service_role;

-- ===== 3. お知らせ・季節の予定 =====
create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  on_date date not null,
  body text not null check (char_length(btrim(body)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.project_events is 'お知らせ・季節の材料の予定（docs/design/auto-post.md の 2.1）。日付から 1 年で消す';
create index project_events_project_idx on public.project_events (project_id, on_date);
alter table public.project_events enable row level security;
create policy "project_events_select_own" on public.project_events
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "project_events_insert_own" on public.project_events
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "project_events_update_own" on public.project_events
  for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "project_events_delete_own" on public.project_events
  for delete to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.project_events from anon, authenticated;
grant select, delete on public.project_events to authenticated;
grant insert (project_id, on_date, body) on public.project_events to authenticated;
grant update (on_date, body) on public.project_events to authenticated;
grant select, insert, update, delete on public.project_events to service_role;

-- 1 プロジェクト 50 件まで。同時に足されても超えないよう、数える前にプロジェクトの行を押さえる（project_destinations と同じ作り）
create function public.project_events_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.projects p where p.id = new.project_id for update;
  if (select count(*) from public.project_events e where e.project_id = new.project_id) >= 50 then
    raise exception 'project_events limit' using errcode = 'P0001', hint = 'project_events_limit';
  end if;
  return new;
end;
$$;
revoke execute on function public.project_events_limit() from public, anon, authenticated;
create trigger project_events_limit
  before insert on public.project_events
  for each row execute function public.project_events_limit();

-- ===== 4. 自動の回で作った投稿の印 =====
alter table public.posts add column auto_run_id uuid references public.auto_runs (id) on delete set null;
comment on column public.posts.auto_run_id is '自動の回で作った投稿（docs/design/auto-post.md の 2.2）。サーバーだけが書く';
create index posts_auto_run_idx on public.posts (auto_run_id) where auto_run_id is not null;

-- posts は利用者に表の全体の insert・update を許しているので、この列だけトリガーで守る（サーバー〈service_role〉と関数の持ち主だけが書ける）
create function public.posts_guard_auto_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.auto_run_id is distinct from (case when tg_op = 'UPDATE' then old.auto_run_id end) then
    raise exception 'auto_run_id is server only' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.posts_guard_auto_run() from public, anon, authenticated;
create trigger posts_guard_auto_run
  before insert or update of auto_run_id on public.posts
  for each row execute function public.posts_guard_auto_run();

-- ===== 5. 確かめて送る =====
alter table public.post_targets drop constraint post_targets_status_check;
alter table public.post_targets add constraint post_targets_status_check
  check (status in ('pending', 'awaiting_approval', 'preparing', 'publishing', 'published', 'failed', 'deleted'));

create table public.post_target_approvals (
  post_target_id uuid primary key references public.post_targets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 承認したときに見せた文の指紋（SHA-256。post_target_fingerprint）
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz not null default now()
);
comment on table public.post_target_approvals is '確かめて送る配信先の承認の記録（docs/design/auto-post.md の 2.3・4.2）。書き込みは関数とサーバーだけ。13 か月で消す';
create index post_target_approvals_owner_idx on public.post_target_approvals (owner_id);
alter table public.post_target_approvals enable row level security;
create policy "post_target_approvals_select_own" on public.post_target_approvals
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.post_target_approvals from anon, authenticated;
grant select on public.post_target_approvals to authenticated;
grant select, insert, update, delete on public.post_target_approvals to service_role;

-- 配信先が送る文の指紋。送信ジョブが送る文と同じ組み立て（post_target_text）に、タイトルを前に足して数える。
-- post_target_text は service_role にしか grant していないので、持ち主の権限で呼ぶ（渡された文から値を計算するだけで、表は読まない）
create function public.post_target_fingerprint(p_title text, p_body text, p_hashtags text[])
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce(p_title, '') || E'\n' || public.post_target_text(p_body, p_hashtags), 'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function public.post_target_fingerprint(text, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.post_target_fingerprint(text, text, text[]) to authenticated, service_role;

-- 承認のあとに文を変えたら、承認を外して確かめ待ちに戻す（見せた中身と送る中身をずらさない）。
-- 配信先の文（body_override・hashtags・title）と、投稿の共通の本文の、どちらが変わっても確かめる
create function public.post_targets_recheck_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
begin
  if tg_table_name = 'posts' then
    v_post_id := new.id;
  else
    v_post_id := new.post_id;
  end if;
  with stale as (
    select t.id
      from public.post_targets t
      join public.posts p on p.id = t.post_id
      join public.post_target_approvals a on a.post_target_id = t.id
     where t.post_id = v_post_id
       and t.status = 'pending'
       and a.fingerprint <> public.post_target_fingerprint(t.title, coalesce(t.body_override, p.body), t.hashtags)
  ), cleared as (
    delete from public.post_target_approvals a using stale s where a.post_target_id = s.id returning a.post_target_id
  )
  update public.post_targets t set status = 'awaiting_approval' from cleared c where t.id = c.post_target_id;
  return null;
end;
$$;
revoke execute on function public.post_targets_recheck_approval() from public, anon, authenticated, service_role;
create trigger post_targets_recheck_approval
  after update of title, body_override, hashtags on public.post_targets
  for each row execute function public.post_targets_recheck_approval();
create trigger posts_recheck_approval
  after update of body on public.posts
  for each row when (old.body is distinct from new.body) execute function public.post_targets_recheck_approval();

-- ===== 6. 関数 =====

-- 自動の回し方を作る・直す。直すたびに、自動で送ることへの同意を取り直す（X の自動化のルール。目的や機能を変えたら同意し直し）。
-- 同意の版は、利用者が最後に同意した規約の版（legal_consents）。直したら、まだ作っていない回を消す（新しい規則でジョブが作り直す）
create function public.save_auto_plan(
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

-- 作り終えて、まだ送っていない自動の回を止める（投稿を下書きに戻すか、そのまま送るか）。内部で使う
create function public.auto_cancel_unsent_runs(p_uid uuid, p_run_ids uuid[], p_to_draft boolean, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_to_draft then
    update public.posts p set status = 'draft', updated_at = now()
      from public.auto_runs r
     where r.id = any(p_run_ids) and r.owner_id = p_uid and r.post_id = p.id
       and r.status in ('scheduled', 'review')
       and not exists (select 1 from public.post_targets t where t.post_id = p.id and t.status not in ('pending', 'awaiting_approval'));
  end if;
  update public.auto_runs r set status = 'canceled', reason = p_reason, updated_at = now()
   where r.id = any(p_run_ids) and r.owner_id = p_uid
     and (r.status = 'waiting' or (p_to_draft and r.status in ('scheduled', 'review')) or (not p_to_draft and r.status = 'review'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.auto_cancel_unsent_runs(uuid, uuid[], boolean, text) from public, anon, authenticated, service_role;

-- 止める・再開する。p_plan_id が null なら、プロジェクトの全部（「全部止める」。止めるだけ）。
-- 止めるときは、まだ作っていない回を止め、p_to_draft なら作り終えた予約も下書きに戻す
create function public.set_auto_plan_status(p_project_id uuid, p_plan_id uuid, p_status text, p_to_draft boolean default true)
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
  select array_agg(a.id) into v_plans from public.auto_plans a
   where a.owner_id = v_uid and a.project_id = p_project_id and (p_plan_id is null or a.id = p_plan_id);
  if v_plans is null then
    if p_plan_id is null then return 0; end if;
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if p_status = 'paused' then
    update public.auto_plans a set status = 'paused', stop_reason = null, updated_at = now() where a.id = any(v_plans);
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

-- 消す。作り終えてまだ送っていない予約は、下書きに戻すか（p_to_draft）、そのまま送る（ふつうの予約として残る）
create function public.delete_auto_plan(p_plan_id uuid, p_to_draft boolean default true)
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
  perform public.auto_cancel_unsent_runs(v_uid, (select array_agg(r.id) from public.auto_runs r where r.plan_id = p_plan_id and r.due_at > now()), coalesce(p_to_draft, true), 'plan_paused');
  delete from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid;
end;
$$;
revoke all on function public.delete_auto_plan(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.delete_auto_plan(uuid, boolean) to authenticated;

-- 次の回を飛ばす（まだ作っていなければ作らない、作り終えていれば下書きに戻す）。飛ばした回の時刻を返す。次の回がまだ決まっていなければ null
create function public.skip_next_auto_run(p_plan_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_run record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.auto_plans a where a.id = p_plan_id and a.owner_id = v_uid) then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  select r.id, r.due_at into v_run from public.auto_runs r
   where r.plan_id = p_plan_id and r.due_at > now() and r.status in ('waiting', 'scheduled', 'review')
   order by r.due_at limit 1 for update;
  if v_run.id is null then
    return null;
  end if;
  perform public.auto_cancel_unsent_runs(v_uid, array[v_run.id], true, 'user_skipped');
  return v_run.due_at;
end;
$$;
revoke all on function public.skip_next_auto_run(uuid) from public, anon, authenticated, service_role;
grant execute on function public.skip_next_auto_run(uuid) to authenticated;

-- 配信先ごとの、送る文とその指紋（確かめる画面が出す中身。承認のときに、この指紋を渡す）。
-- post_target_text を持ち主の権限で呼ぶため security definer にし、本人の投稿だけを返す
create function public.auto_target_previews(p_post_id uuid)
returns table (target_id uuid, sns text, status text, title text, body text, fingerprint text, approved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.sns, t.status, t.title, public.post_target_text(coalesce(t.body_override, p.body), t.hashtags),
         public.post_target_fingerprint(t.title, coalesce(t.body_override, p.body), t.hashtags), a.approved_at
    from public.post_targets t
    join public.posts p on p.id = t.post_id
    left join public.post_target_approvals a on a.post_target_id = t.id
   where t.post_id = p_post_id
     and p.owner_id = (select auth.uid())
   order by t.sns;
$$;
revoke all on function public.auto_target_previews(uuid) from public, anon, authenticated, service_role;
grant execute on function public.auto_target_previews(uuid) to authenticated;

-- 承認の中身（内部で使う）: 見せた指紋がいまの文と同じときだけ、承認を記録して pending に戻す。送る時刻を過ぎたものは承認できない
create function public.auto_approve_target(p_uid uuid, p_target_id uuid, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_planned timestamptz;
begin
  select public.post_target_fingerprint(t.title, coalesce(t.body_override, p.body), t.hashtags), p.planned_at
    into v_current, v_planned
    from public.post_targets t join public.posts p on p.id = t.post_id
   where t.id = p_target_id and t.owner_id = p_uid and t.status = 'awaiting_approval'
   for update of t;
  if v_current is null then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
  if v_planned is null or v_planned <= now() then
    raise exception 'approval expired' using errcode = 'P0001', hint = 'approval_expired';
  end if;
  if p_fingerprint is distinct from v_current then
    raise exception 'content changed' using errcode = 'P0001', hint = 'content_changed';
  end if;
  insert into public.post_target_approvals (post_target_id, owner_id, fingerprint) values (p_target_id, p_uid, v_current)
  on conflict (post_target_id) do update set fingerprint = excluded.fingerprint, approved_at = now();
  update public.post_targets t set status = 'pending', updated_at = now() where t.id = p_target_id;
end;
$$;
revoke all on function public.auto_approve_target(uuid, uuid, text) from public, anon, authenticated, service_role;

-- 確かめて送る SNS の 1 つを承認する（X など。docs/design/auto-post.md の 1.6）
create function public.approve_auto_target(p_target_id uuid, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.auto_approve_target(auth.uid(), p_target_id, p_fingerprint);
end;
$$;
revoke all on function public.approve_auto_target(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.approve_auto_target(uuid, text) to authenticated;

-- 確かめて送る SNS の 1 つを送らない（その配信先を外す。ほかの SNS は送る）。配信先が 1 つも残らなければ、投稿を下書きに戻す
create function public.decline_auto_target(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_post uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.post_targets t where t.id = p_target_id and t.owner_id = v_uid and t.status = 'awaiting_approval'
  returning t.post_id into v_post;
  if v_post is null then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.post_targets t where t.post_id = v_post) then
    update public.posts p set status = 'draft', updated_at = now() where p.id = v_post;
  end if;
end;
$$;
revoke all on function public.decline_auto_target(uuid) from public, anon, authenticated, service_role;
grant execute on function public.decline_auto_target(uuid) to authenticated;

-- 最初の回の確かめ（A3）。送るなら、見せた指紋（{配信先の id: 指紋}）で確かめ待ちの SNS もまとめて承認し、投稿を予約にする。
-- 承認した回し方は、次の回から確かめない。送らないなら、その回は下書きのまま残す（次の回もまた確かめる）
create function public.review_auto_run(p_run_id uuid, p_send boolean, p_fingerprints jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_run record;
  v_target record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select r.id, r.plan_id, r.post_id, r.due_at into v_run from public.auto_runs r
   where r.id = p_run_id and r.owner_id = v_uid and r.status = 'review' for update;
  if v_run.id is null or v_run.post_id is null then
    raise exception 'run not found' using errcode = 'P0002';
  end if;
  if not p_send then
    update public.auto_runs r set status = 'canceled', reason = 'user_skipped', updated_at = now() where r.id = v_run.id;
    return;
  end if;
  if v_run.due_at <= now() then
    raise exception 'approval expired' using errcode = 'P0001', hint = 'approval_expired';
  end if;
  for v_target in select t.id from public.post_targets t where t.post_id = v_run.post_id and t.status = 'awaiting_approval' loop
    perform public.auto_approve_target(v_uid, v_target.id, p_fingerprints->>v_target.id::text);
  end loop;
  update public.posts p set status = 'scheduled', planned_at = v_run.due_at, updated_at = now() where p.id = v_run.post_id and p.owner_id = v_uid;
  update public.auto_runs r set status = 'scheduled', updated_at = now() where r.id = v_run.id;
  update public.auto_plans a set first_review = false, updated_at = now() where a.id = v_run.plan_id;
end;
$$;
revoke all on function public.review_auto_run(uuid, boolean, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.review_auto_run(uuid, boolean, jsonb) to authenticated;

-- 作る時刻が来た回を取り出す（ジョブ。for update skip locked で、重なって呼ばれても同じ回を 2 回取り出さない）。
-- 作っている途中で 10 分たったもの（ジョブが落ちた）は、もう一度取り出す（3 回まで。超えたら skipped）
create function public.claim_due_auto_runs(p_limit integer default 5)
returns setof public.auto_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auto_runs r set status = 'skipped', reason = 'error', locked_at = null, updated_at = now()
   where r.status = 'generating' and r.locked_at < now() - interval '10 minutes' and r.attempts >= 3;
  return query
  with due as (
    select r.id from public.auto_runs r
      join public.auto_plans a on a.id = r.plan_id
     where a.status = 'active'
       and r.due_at > now()
       and ((r.status = 'waiting' and r.generate_at <= now())
         or (r.status = 'generating' and r.locked_at < now() - interval '10 minutes'))
     order by r.due_at
     limit least(greatest(p_limit, 1), 25)
     for update of r skip locked
  )
  update public.auto_runs r set status = 'generating', locked_at = now(), attempts = r.attempts + 1, updated_at = now()
    from due where r.id = due.id
  returning r.*;
end;
$$;
revoke all on function public.claim_due_auto_runs(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_due_auto_runs(integer) to service_role;

-- ===== 7. 保存の関数: 確かめ待ちの配信先も、送る前の配信先として直す・外す =====
-- 20261112130000_post_hashtags の定義の写し。pending だけだった 2 か所（外す・直す）に awaiting_approval を足す。
-- 確かめ待ちの配信先の状態は変えない（直したら post_targets_recheck_approval が承認を外す。承認の前なら確かめ待ちのまま）
create or replace function public.save_post(
  p_post_id uuid,
  p_project_id uuid,
  p_body text,
  p_planned_at timestamptz,
  p_status text,
  p_targets jsonb,
  p_text_origin text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post_id uuid;
begin
  if p_text_origin is not null and p_text_origin not in ('self', 'ai') then
    raise exception 'invalid text origin' using errcode = '22023';
  end if;
  if p_post_id is null then
    insert into public.posts (project_id, body, planned_at, status, text_origin)
    values (p_project_id, p_body, p_planned_at, p_status, coalesce(p_text_origin, 'self'))
    returning id into v_post_id;
  else
    update public.posts
      set body = p_body, planned_at = p_planned_at, status = p_status, text_origin = coalesce(p_text_origin, text_origin)
      where id = p_post_id and project_id = p_project_id
      returning id into v_post_id;
    if v_post_id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
  end if;

  -- 外された SNS の配信先を消す（送信済みのものは残す）
  delete from public.post_targets t
    where t.post_id = v_post_id
      and t.status in ('pending', 'awaiting_approval')
      and t.sns not in (select x->>'sns' from jsonb_array_elements(p_targets) as x);

  insert into public.post_targets (post_id, sns, title, body_override, social_account_id, quote_post_id, hashtags)
  select v_post_id,
         x->>'sns',
         nullif(x->>'title', ''),
         nullif(x->>'body_override', ''),
         nullif(x->>'social_account_id', '')::uuid,
         nullif(x->>'quote_post_id', ''),
         case when x ? 'hashtags' then array(select jsonb_array_elements_text(x->'hashtags')) else '{}'::text[] end
    from jsonb_array_elements(p_targets) as x
  on conflict (post_id, sns) do update
    set title = excluded.title,
        body_override = excluded.body_override,
        social_account_id = excluded.social_account_id,
        quote_post_id = excluded.quote_post_id,
        hashtags = case
          when exists (select 1 from jsonb_array_elements(p_targets) as y where y->>'sns' = excluded.sns and y ? 'hashtags') then excluded.hashtags
          else public.post_targets.hashtags
        end
    where public.post_targets.status in ('pending', 'awaiting_approval');

  return v_post_id;
end;
$$;

revoke all on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb, text) to authenticated;

-- ===== 8. 送る前の配信先として、確かめ待ちも扱う（ほかの関数） =====
-- post_targets_lock_sent（20261113100000 の写し）: 確かめ待ちの配信先の文面・タグも、利用者が直せるようにする（送る前なので）。
-- 直したら post_targets_recheck_approval が承認を外す
create or replace function public.post_targets_lock_sent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status not in ('pending', 'awaiting_approval')
     and current_user = 'authenticated'
     and (new.body_override is distinct from old.body_override
       or new.title is distinct from old.title
       or new.hashtags is distinct from old.hashtags
       or new.quote_post_id is distinct from old.quote_post_id
       or new.social_account_id is distinct from old.social_account_id)
  then
    raise exception '送った（送っている）配信先の文面・タグ・送り先のアカウントは変えられません'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- switch_project_sns_account（20261012000000 の写し）: SNS のアカウントをつなぎ替えたとき、確かめ待ちの配信先も新しいアカウントに付け替える
create or replace function public.switch_project_sns_account(p_owner_id uuid, p_project_id uuid, p_account_id uuid)
returns table (old_account_id uuid, old_handle text, old_display_name text, still_used boolean, moved_targets integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sns public.sns_key;
  v_old record;
  v_moved integer;
begin
  perform pg_advisory_xact_lock(hashtext('project_social_accounts:' || p_project_id::text));
  if not exists (select 1 from public.projects where id = p_project_id and owner_id = p_owner_id) then
    raise exception 'project not found';
  end if;
  select sns into v_sns from public.social_accounts where id = p_account_id and owner_id = p_owner_id;
  if v_sns is null then
    raise exception 'account not found';
  end if;

  for v_old in
    select a.id, a.handle, a.display_name
      from public.project_social_accounts psa
      join public.social_accounts a on a.id = psa.social_account_id
     where psa.project_id = p_project_id
       and a.sns = v_sns
       and a.id <> p_account_id
  loop
    update public.post_targets t
       set social_account_id = p_account_id
      from public.posts p
     where p.id = t.post_id
       and p.project_id = p_project_id
       and t.social_account_id = v_old.id
       and t.status in ('pending', 'awaiting_approval', 'failed');
    get diagnostics v_moved = row_count;

    delete from public.project_social_accounts where project_id = p_project_id and social_account_id = v_old.id;

    old_account_id := v_old.id;
    old_handle := v_old.handle;
    old_display_name := v_old.display_name;
    still_used := exists (select 1 from public.project_social_accounts where social_account_id = v_old.id);
    moved_targets := v_moved;
    return next;
  end loop;

  insert into public.project_social_accounts (project_id, social_account_id, owner_id)
  values (p_project_id, p_account_id, p_owner_id)
  on conflict do nothing;
end;
$$;
