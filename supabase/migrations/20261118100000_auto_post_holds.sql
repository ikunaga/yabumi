-- 運営者が、利用者ごとに自動の投稿を止める（docs/launch-checklist.md の 1.1。2026-11-17 のセキュリティ確認の M1・R4 の残り。
-- 2026-11-18 オーナーが了承。PM の依頼。docs/design/auto-post.md・architecture.md の 4.77）。
-- 回し方ごとの止め方（auto_plans.stop_reason = 'operator'）は、プロジェクトを消して作り直すと抜けられた。利用者の単位の印にして塞ぐ。
-- 1. auto_post_holds: 止めた記録（1 行が止めた 1 回。解除しても行を残す）。利用者は自分の行の日時だけ読める（理由・運営者は読めない）。書くのはサーバーだけ
-- 2. auto_post_held(uid): いま止めているか（内部とサーバーだけ）
-- 3. 止めている間に断る: save_auto_plan（作る・直す）・set_auto_plan_status の再開・auto_approve_target と review_auto_run（送る方向の承認）・
--    requeue_failed_targets（自動で作った投稿の送り直し）。hint は auto_post_hold。止める・消す・飛ばす・送らないは断らない
-- 4. ジョブ: claim_due_auto_runs が止めている人の回を取り出さない。claim_due_targets が止めている人の自動で作った投稿を送らない。
--    reserve_ai_usage が止めている人の自動の投稿の AI（auto_post・auto_post_check）を断る（status = auto_post_hold）
-- 5. 運営者の関数（service_role だけ）: operator_hold_auto_post（止めて、まだ送っていない回を取り消し、投稿を下書きに戻す）・
--    operator_release_auto_post（解除して、動いている回し方の最初の回をまた確かめてもらう）・operator_auto_post_holds（止めている人の一覧）。
--    /admin/auto-holds と docs/deploy.md の 32 から呼ぶ
-- 6. 2026-11-18 の PM のセキュリティ確認の DB の Low（同じ関数を作り直すので、ここに入れた）
--    L1: 承認の指紋の作り方を変えた（20261117130000）あと、前の指紋の承認が残り、確かめて送る SNS の pending が claim_due_targets で黙って飛ばされ続けた。
--        指紋の合わない承認を消して確かめ待ちに戻す（データの直し）。claim_due_targets でも、飛ばさずに確かめ待ちに戻す
--    L2: 承認の指紋に、添えた画像の代替テキスト（X に送る）を入れる。代替テキストを変えたら確かめ待ちに戻す
--    L3: 回し方を運営者が止めている（stop_reason = 'operator'）回は、送る方向の承認（auto_approve_target・review_auto_run の送る）を断る
-- それぞれの関数は、前の定義の写しに確かめを 1 つずつ足したもの（元: save_auto_plan は 20261117150000、set_auto_plan_status・auto_approve_target・
-- requeue_failed_targets・claim_due_targets は 20261117130000、review_auto_run は 20261116100000、claim_due_auto_runs は 20261116120000、
-- reserve_ai_usage は 20261116110000）

-- ===== 1. 止めた記録 =====
create table public.auto_post_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 運営者のメモ（利用者には見せない。調べている途中のことや、ほかの人のことを含みうるため）
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  -- だれが止めたか（/admin なら運営者のメールアドレス、SQL なら 'sql'）
  held_by text not null check (char_length(btrim(held_by)) between 1 and 254),
  held_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text check (release_reason is null or char_length(btrim(release_reason)) between 1 and 200),
  released_by text check (released_by is null or char_length(btrim(released_by)) between 1 and 254),
  -- 利用者に知らせた日時（止めた・解除した。ジョブがスマホの通知で 1 回ずつ送る）
  hold_notified_at timestamptz,
  release_notified_at timestamptz,
  constraint auto_post_holds_release check (
    (released_at is null) = (release_reason is null) and (released_at is null) = (released_by is null)
  )
);
comment on table public.auto_post_holds is '運営者が利用者ごとに自動の投稿を止めた記録（docs/design/auto-post.md）。released_at が null の行が、いま止めているもの。書くのは operator_* の関数とサーバーだけ。退会で消える';
-- いま止めているのは 1 人 1 行まで
create unique index auto_post_holds_active_idx on public.auto_post_holds (user_id) where released_at is null;
create index auto_post_holds_user_idx on public.auto_post_holds (user_id, held_at desc);
alter table public.auto_post_holds enable row level security;
create policy "auto_post_holds_select_own" on public.auto_post_holds
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.auto_post_holds from anon, authenticated;
-- 利用者が読めるのは、止められた日時と解除の日時だけ（理由・だれが止めたかは見せない）
grant select (id, user_id, held_at, released_at) on public.auto_post_holds to authenticated;
grant select, insert, update, delete on public.auto_post_holds to service_role;

-- ===== 2. いま止めているか =====
-- ほかの人が止められているかを知られないよう、利用者には与えない（関数の中とサーバーだけ）
create function public.auto_post_held(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.auto_post_holds h where h.user_id = p_uid and h.released_at is null);
$$;
revoke all on function public.auto_post_held(uuid) from public, anon, authenticated, service_role;
grant execute on function public.auto_post_held(uuid) to service_role;

-- 止めたときに取り消した回の理由
alter table public.auto_runs drop constraint auto_runs_reason_check;
alter table public.auto_runs add constraint auto_runs_reason_check check (reason is null or reason in (
  'no_material', 'cannot_write', 'check_failed', 'similar', 'made_up', 'avoid', 'too_long', 'ai_limit', 'daily_limit',
  'disconnected', 'error', 'user_skipped', 'plan_paused', 'operator_hold'
));

-- ===== 3・4. 止めている間に断る =====
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

create or replace function public.auto_approve_target(p_uid uuid, p_target_id uuid, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_planned timestamptz;
begin
  -- 運営者が利用者ごとに止めている間は、送る方向の承認を断る（approve_auto_target と review_auto_run の両方がここを通る）
  if public.auto_post_held(p_uid) then
    raise exception 'auto post held' using errcode = '42501', hint = 'auto_post_hold';
  end if;
  -- 回し方を運営者が止めている回の投稿も、承認を断る（L3）
  if exists (
    select 1 from public.post_targets t
      join public.posts p on p.id = t.post_id
      join public.auto_runs r on r.id = p.auto_run_id
      join public.auto_plans a on a.id = r.plan_id
     where t.id = p_target_id and t.owner_id = p_uid and a.stop_reason = 'operator'
  ) then
    raise exception 'stopped by operator' using errcode = '42501', hint = 'auto_plan_operator_stop';
  end if;
  select public.post_target_approval_fingerprint(t.id), p.planned_at
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

create or replace function public.review_auto_run(p_run_id uuid, p_send boolean, p_fingerprints jsonb default '{}'::jsonb)
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
  -- 運営者が利用者ごとに止めている間は、送るを断る（確かめ待ちの SNS がない回もあるので、ここでも見る）
  if public.auto_post_held(v_uid) then
    raise exception 'auto post held' using errcode = '42501', hint = 'auto_post_hold';
  end if;
  -- 回し方を運営者が止めているときも、送るを断る（L3）
  if exists (select 1 from public.auto_plans a where a.id = v_run.plan_id and a.stop_reason = 'operator') then
    raise exception 'stopped by operator' using errcode = '42501', hint = 'auto_plan_operator_stop';
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

create or replace function public.requeue_failed_targets(p_post_id uuid, p_sns text[]) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- security definer なので、本人の投稿であることをここで確かめる
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.owner_id = (select auth.uid())) then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  -- 運営者が利用者ごとに止めている間は、自動で作った投稿を送り直さない（手で作った投稿はよい）
  if public.auto_post_held((select auth.uid())) and exists (select 1 from public.posts p where p.id = p_post_id and p.auto_created) then
    raise exception 'auto post held' using errcode = '42501', hint = 'auto_post_hold';
  end if;
  update public.post_targets t
    set status = case
          when public.is_review_sns(t.sns)
           and exists (select 1 from public.posts p where p.id = t.post_id and p.auto_created)
           and not exists (select 1 from public.post_target_approvals a
                            where a.post_target_id = t.id and a.fingerprint = public.post_target_approval_fingerprint(t.id))
          then 'awaiting_approval'
          else 'pending'
        end,
        attempts = 0, next_attempt_at = null, locked_at = null, error_message = null
    where t.post_id = p_post_id and t.status = 'failed' and t.sns = any (p_sns);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.requeue_failed_targets(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.requeue_failed_targets(uuid, text[]) to authenticated;

create or replace function public.claim_due_auto_runs(p_limit integer default 5, p_owner_ids uuid[] default null)
returns setof public.auto_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.auto_runs r set status = 'skipped', reason = 'error', locked_at = null, updated_at = now()
   where r.status = 'generating' and r.locked_at < now() - interval '10 minutes' and r.attempts >= 3
     and (p_owner_ids is null or r.owner_id = any(p_owner_ids));
  return query
  with due as (
    select r.id from public.auto_runs r
      join public.auto_plans a on a.id = r.plan_id
     where a.status = 'active'
       and r.due_at > now()
       -- 運営者が利用者ごとに止めている人の回は作らない
       and not public.auto_post_held(r.owner_id)
       and (p_owner_ids is null or r.owner_id = any(p_owner_ids))
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
revoke all on function public.claim_due_auto_runs(integer, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_due_auto_runs(integer, uuid[]) to service_role;

create or replace function public.claim_due_targets(p_limit integer default 10, p_post_id uuid default null)
returns table (
  target_id uuid,
  post_id uuid,
  sns text,
  social_account_id uuid,
  account_external_id text,
  account_status text,
  body text,
  attempts integer,
  sns_container jsonb,
  preparing_since timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 送信中のまま 10 分たったものは、送れたかどうかわからないので失敗にする（自動ではやり直さない。二重投稿を避けるため）
  update public.post_targets t
    set status = 'failed', locked_at = null,
        error_message = '送信の途中で止まりました。SNS 側に投稿されているか確かめてから、必要ならもう一度送ってください。'
    where t.status = 'publishing' and t.locked_at < now() - interval '10 minutes';

  -- 自動で作った投稿の、確かめて送る SNS で、いまの中身への承認がない pending は、黙って飛ばさずに確かめ待ちに戻す（L1。
  -- 承認のあとに中身が変わった・指紋の作り方が変わったなど）。合わない承認は消す
  with stale as (
    select t.id
      from public.post_targets t
      join public.posts p on p.id = t.post_id
     where t.status = 'pending'
       and p.auto_created
       and public.is_review_sns(t.sns)
       and (p_post_id is null or p.id = p_post_id)
       and not exists (select 1 from public.post_target_approvals a
                        where a.post_target_id = t.id and a.fingerprint = public.post_target_approval_fingerprint(t.id))
       for update of t skip locked
  ), cleared as (
    delete from public.post_target_approvals a using stale s where a.post_target_id = s.id returning a.post_target_id
  )
  update public.post_targets t set status = 'awaiting_approval', updated_at = now() from stale s where t.id = s.id;

  return query
  with due as (
    select t.id
      from public.post_targets t
      join public.posts p on p.id = t.post_id
     where not public.is_manual_sns(t.sns)
       and t.quote_post_id is null
       and (p_post_id is null or p.id = p_post_id)
       and (
         -- 送る時刻が来たもの。「今すぐ送る」（p_post_id あり）は時刻を見ない（アプリと DB の時計のずれで取りこぼさないため）
         (t.status = 'pending'
           and p.status = 'scheduled'
           and (p.planned_at <= now() or p.id = p_post_id)
           and (t.next_attempt_at is null or t.next_attempt_at <= now() or p.id = p_post_id)
           -- 自動で作った投稿の、確かめて送る SNS は、いまの中身への承認があるものだけ
           -- 運営者が利用者ごとに止めている人の、自動で作った投稿は送らない
           and not (p.auto_created and public.auto_post_held(p.owner_id))
           and not (p.auto_created and public.is_review_sns(t.sns)
                    and not exists (select 1 from public.post_target_approvals a
                                     where a.post_target_id = t.id and a.fingerprint = public.post_target_approval_fingerprint(t.id))))
         -- 準備中で、続きを確かめる時刻が来たもの
         or (t.status = 'preparing' and (t.next_attempt_at is null or t.next_attempt_at <= now()))
       )
     -- 準備中のもの（もう始めている）を先に、次に予約の時刻の早い順
     order by (t.status = 'preparing') desc, p.planned_at, t.id
     limit p_limit
     for update of t skip locked
  ),
  claimed as (
    update public.post_targets t
       -- 準備の続きを確かめるだけのときは、試した回数を増やさない
       set status = 'publishing', locked_at = now(), attempts = t.attempts + case when t.status = 'preparing' then 0 else 1 end
      from due
     where t.id = due.id
    returning t.id, t.post_id, t.sns, t.social_account_id, t.body_override, t.hashtags, t.attempts, t.sns_container, t.preparing_since
  )
  select c.id, c.post_id, c.sns::text, c.social_account_id, a.external_id, a.status,
         public.post_target_text(coalesce(c.body_override, p.body), c.hashtags), c.attempts, c.sns_container, c.preparing_since
    from claimed c
    join public.posts p on p.id = c.post_id
    left join public.social_accounts a on a.id = c.social_account_id;
end;
$$;
revoke execute on function public.claim_due_targets(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_due_targets(integer, uuid) to service_role;

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
  v_auto boolean := p_purpose in ('auto_post', 'auto_post_check');
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
     and (a.purpose in ('auto_post', 'auto_post_check')) = v_auto
     and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
  select coalesce(sum(a.cost_usd) filter (where a.created_at >= v_month_start), 0),
         (count(*) filter (where a.created_at >= v_day_start))::integer,
         (count(*) filter (where a.created_at >= v_day_start and a.purpose = 'auto_post'))::integer
    into v_user, v_today, v_auto_today
    from public.ai_usage a
   where a.owner_id = p_owner_id
     and (a.purpose in ('auto_post', 'auto_post_check')) = v_auto
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
       and (a.purpose in ('auto_post', 'auto_post_check')) = v_auto
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

comment on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) is '文章の AI を呼ぶ前に、上限（関数の中で固定）を確かめて見込みの費用で予約する。見込みは用途ごとの下限と 1 回の上限（$1）で挟む。自動の投稿（auto_post・auto_post_check）は別の枠で数え、運営者が止めている人は断る。断った分は記録しない';
revoke all on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) to service_role;

-- ===== 5. 運営者の関数 =====
-- メールアドレスから利用者を引く（運営者が知っているのはメールアドレス）。見つからなければ P0002
create function public.operator_user_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;
revoke all on function public.operator_user_by_email(text) from public, anon, authenticated, service_role;

-- 止める。すでに止めていれば何もしない（前の理由のまま）。まだ送っていない自動の回を取り消し、作り終えた投稿は下書きに戻す
-- （「全部止める」の下書きに戻すと同じ。送り始めたもの・送ったものには触らない。作っている途中の回は、ジョブが見直して取り消す）
create function public.operator_hold_auto_post(p_email text, p_reason text, p_by text)
returns table (hold_id uuid, already_held boolean, canceled_runs integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id uuid;
  v_count integer;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200
     or p_by is null or char_length(btrim(p_by)) not between 1 and 254 then
    raise exception 'invalid hold' using errcode = '22023';
  end if;
  v_uid := public.operator_user_by_email(p_email);
  -- 同じ人を同時に止めても、行は 1 つ（一意の索引でも守る）
  perform pg_advisory_xact_lock(hashtext('auto_post_hold:' || v_uid::text));
  select h.id into v_id from public.auto_post_holds h where h.user_id = v_uid and h.released_at is null;
  if v_id is not null then
    return query select v_id, true, 0;
    return;
  end if;
  insert into public.auto_post_holds (user_id, reason, held_by) values (v_uid, btrim(p_reason), btrim(p_by)) returning id into v_id;
  v_count := coalesce(public.auto_cancel_unsent_runs(
    v_uid,
    (select array_agg(r.id) from public.auto_runs r where r.owner_id = v_uid and r.due_at > now()),
    true,
    'operator_hold'
  ), 0);
  return query select v_id, false, v_count;
end;
$$;
revoke all on function public.operator_hold_auto_post(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.operator_hold_auto_post(text, text, text) to service_role;

-- 解除する。止めていなければ released = false。動いている回し方は、急に送り始めないよう、最初の回をまた確かめてもらう（first_review）。
-- 止めたときに取り消した、まだ来ていない回（投稿を作る前のもの）は消して、ジョブに規則から足し直させる
create function public.operator_release_auto_post(p_email text, p_reason text, p_by text)
returns table (hold_id uuid, released boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200
     or p_by is null or char_length(btrim(p_by)) not between 1 and 254 then
    raise exception 'invalid release' using errcode = '22023';
  end if;
  v_uid := public.operator_user_by_email(p_email);
  perform pg_advisory_xact_lock(hashtext('auto_post_hold:' || v_uid::text));
  update public.auto_post_holds h
     set released_at = now(), release_reason = btrim(p_reason), released_by = btrim(p_by)
   where h.user_id = v_uid and h.released_at is null
  returning h.id into v_id;
  if v_id is null then
    return query select null::uuid, false;
    return;
  end if;
  update public.auto_plans a set first_review = true, updated_at = now() where a.owner_id = v_uid and a.status = 'active';
  delete from public.auto_runs r
   where r.owner_id = v_uid and r.status = 'canceled' and r.reason = 'operator_hold' and r.due_at > now() and r.post_id is null;
  return query select v_id, true;
end;
$$;
revoke all on function public.operator_release_auto_post(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.operator_release_auto_post(text, text, text) to service_role;

-- いま止めている人の一覧（運営の画面と SQL の手順）。メールアドレスを返すので service_role だけ
create function public.operator_auto_post_holds()
returns table (hold_id uuid, email text, reason text, held_by text, held_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, u.email::text, h.reason, h.held_by, h.held_at
    from public.auto_post_holds h
    join auth.users u on u.id = h.user_id
   where h.released_at is null
   order by h.held_at desc;
$$;
revoke all on function public.operator_auto_post_holds() from public, anon, authenticated, service_role;
grant execute on function public.operator_auto_post_holds() to service_role;

-- ===== 6. L2: 承認の指紋に代替テキストを入れる =====
-- 20261117130000 の写し。media に、画像ごとの代替テキストの md5 を足す（区切りの文字を含んでも、ほかの並びと同じにならないように）
create or replace function public.post_target_approval_fingerprint(p_target_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(
           coalesce(t.title, '') || E'\n' || public.post_target_text(coalesce(t.body_override, p.body), t.hashtags)
           || E'\naccount:' || coalesce(t.social_account_id::text, '')
           || E'\nquote:' || coalesce(t.quote_post_id, '')
           || E'\nmedia:' || coalesce((select string_agg(m.id::text || ':' || md5(m.alt_text), ',' order by m.position, m.id)
                                         from public.media_files m where m.post_id = p.id and m.removed_at is null), ''),
           'UTF8'), 'sha256'), 'hex')
    from public.post_targets t
    join public.posts p on p.id = t.post_id
   where t.id = p_target_id;
$$;
revoke all on function public.post_target_approval_fingerprint(uuid) from public, anon, authenticated, service_role;
grant execute on function public.post_target_approval_fingerprint(uuid) to service_role;

-- 承認のあとに代替テキストを変えたら、確かめ待ちに戻す
drop trigger media_files_recheck_approval on public.media_files;
create trigger media_files_recheck_approval
  after insert or update of post_id, position, removed_at, alt_text or delete on public.media_files
  for each row execute function public.post_targets_recheck_approval();

-- ===== 6. L1: データの直し =====
-- 指紋の合わない承認（指紋の作り方を変える前の承認と、上の L2 で変わったもの）を消し、その配信先を確かめ待ちに戻す。
-- 送る前（pending）の、自動で作った投稿の、確かめて送る SNS だけ
with stale as (
  select t.id
    from public.post_targets t
    join public.posts p on p.id = t.post_id
   where t.status = 'pending'
     and p.auto_created
     and public.is_review_sns(t.sns)
     and not exists (select 1 from public.post_target_approvals a
                      where a.post_target_id = t.id and a.fingerprint = public.post_target_approval_fingerprint(t.id))
), cleared as (
  delete from public.post_target_approvals a using stale s where a.post_target_id = s.id returning a.post_target_id
)
update public.post_targets t set status = 'awaiting_approval', updated_at = now() from stale s where t.id = s.id;
