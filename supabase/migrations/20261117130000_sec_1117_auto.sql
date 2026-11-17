-- 2026-11-17 のセキュリティ確認（7121224 以降）の、自動の投稿まわりの直し（docs/design/auto-post.md）。
-- M1: 運営者が止めた回し方（stop_reason = 'operator'）を、利用者が再開・一時停止で外せないようにする
-- L1: 確かめて送る SNS（X・TikTok・YouTube）の承認を、本人の操作で飛ばせないようにする
--   - posts.auto_created: 自動で作った投稿の消えない印（auto_run_id は回し方を消すと null になるので、判定に使わない）。サーバーだけが書ける
--   - post_targets の BEFORE INSERT: 印のある投稿に、利用者が X・TikTok・YouTube の配信先を足したら（外して付け直しを含む）確かめ待ちにする
--   - 送り直し（requeue_failed_targets）・送信ジョブ（claim_due_targets）も印で判定し、承認の記録（いまの指紋と同じもの）がなければ送らない
--   - 承認の指紋に、添えた画像・動画、送り先のアカウント、引用する投稿を入れる。承認のあとに変えたら確かめ待ちに戻す
-- DB-L3: トリガーの関数の revoke に service_role を足す

-- ===== M1 =====
-- 20261116100000_auto_post の定義の写し。運営者が止めた回し方は、利用者からは状態を変えられない（再開は 42501。全部止めるは飛ばす）
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

-- ===== L1: 自動で作った投稿の消えない印 =====
alter table public.posts add column auto_created boolean not null default false;
comment on column public.posts.auto_created is '自動の投稿で作った投稿（docs/design/auto-post.md の 2.2）。回し方や回を消しても残る。サーバーだけが書き、一度付いたら外れない';
update public.posts set auto_created = true where auto_run_id is not null;

-- auto_run_id に加えて auto_created も守る。サーバーが auto_run_id を付けたら auto_created も付け、一度付いた印は外さない
create or replace function public.posts_guard_auto_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.auto_run_id is distinct from (case when tg_op = 'UPDATE' then old.auto_run_id end)
       or new.auto_created is distinct from (case when tg_op = 'UPDATE' then old.auto_created else false end)) then
    raise exception 'auto_run_id is server only' using errcode = '42501';
  end if;
  if new.auto_run_id is not null or (tg_op = 'UPDATE' and old.auto_created) then
    new.auto_created := true;
  end if;
  return new;
end;
$$;
revoke all on function public.posts_guard_auto_run() from public, anon, authenticated, service_role;
drop trigger posts_guard_auto_run on public.posts;
create trigger posts_guard_auto_run
  before insert or update of auto_run_id, auto_created on public.posts
  for each row execute function public.posts_guard_auto_run();

-- 確かめて送る SNS か（X の Developer Policy・TikTok・YouTube の 1 本ごとの同意。auto-post.md の 4.2）
create function public.is_review_sns(p_sns text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_sns in ('x', 'tiktok', 'youtube');
$$;
revoke all on function public.is_review_sns(text) from public, anon, authenticated, service_role;
grant execute on function public.is_review_sns(text) to authenticated, service_role;

-- 利用者が足した配信先（外して付け直す・save_post を含む）は、自動で作った投稿の X・TikTok・YouTube なら確かめ待ちにする。
-- 誰が足したかを current_user で見るので security invoker にする（definer だと current_user が関数の持ち主になる）。
-- 投稿は本人のもの（post_targets の insert のポリシー）なので、RLS のまま読める
create function public.post_targets_auto_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and public.is_review_sns(new.sns)
     and new.status = 'pending'
     and exists (select 1 from public.posts p where p.id = new.post_id and p.auto_created) then
    new.status := 'awaiting_approval';
  end if;
  return new;
end;
$$;
revoke all on function public.post_targets_auto_review() from public, anon, authenticated, service_role;
create trigger post_targets_auto_review
  before insert on public.post_targets
  for each row execute function public.post_targets_auto_review();

-- ===== L1: 承認の指紋 =====
-- 配信先が送るものの指紋。送る文（タイトル＋post_target_text）に、送り先のアカウント・引用する投稿・添えた画像と動画（id と並び）を足す。
-- 中で表を読むので、関数とサーバーからだけ呼ぶ（利用者には auto_target_previews が本人の投稿の分だけ返す）
create function public.post_target_approval_fingerprint(p_target_id uuid)
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
           || E'\nmedia:' || coalesce((select string_agg(m.id::text, ',' order by m.position, m.id)
                                         from public.media_files m where m.post_id = p.id and m.removed_at is null), ''),
           'UTF8'), 'sha256'), 'hex')
    from public.post_targets t
    join public.posts p on p.id = t.post_id
   where t.id = p_target_id;
$$;
revoke all on function public.post_target_approval_fingerprint(uuid) from public, anon, authenticated, service_role;
grant execute on function public.post_target_approval_fingerprint(uuid) to service_role;

-- 前の指紋（文だけ）は使わなくなったので消す
drop function public.post_target_fingerprint(text, text, text[]);

-- 20261116100000_auto_post の写し。指紋を新しいものにする
create or replace function public.auto_target_previews(p_post_id uuid)
returns table (target_id uuid, sns text, status text, title text, body text, fingerprint text, approved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.sns, t.status, t.title, public.post_target_text(coalesce(t.body_override, p.body), t.hashtags),
         public.post_target_approval_fingerprint(t.id), a.approved_at
    from public.post_targets t
    join public.posts p on p.id = t.post_id
    left join public.post_target_approvals a on a.post_target_id = t.id
   where t.post_id = p_post_id
     and p.owner_id = (select auth.uid())
   order by t.sns;
$$;
revoke all on function public.auto_target_previews(uuid) from public, anon, authenticated, service_role;
grant execute on function public.auto_target_previews(uuid) to authenticated;

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

-- 承認のあとに送るものを変えたら、承認を外して確かめ待ちに戻す。配信先の文・タグ・タイトル・アカウント・引用、投稿の本文、添えた画像と動画のどれが変わっても確かめる
create or replace function public.post_targets_recheck_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_posts uuid[];
begin
  if tg_table_name = 'posts' then
    v_posts := array[new.id];
  elsif tg_table_name = 'post_targets' then
    v_posts := array[new.post_id];
  elsif tg_op = 'DELETE' then
    v_posts := array[old.post_id];
  elsif tg_op = 'INSERT' then
    v_posts := array[new.post_id];
  else
    v_posts := array[old.post_id, new.post_id];
  end if;
  with stale as (
    select t.id
      from public.post_targets t
      join public.post_target_approvals a on a.post_target_id = t.id
     where t.post_id = any(v_posts)
       and t.status = 'pending'
       and a.fingerprint <> public.post_target_approval_fingerprint(t.id)
  ), cleared as (
    delete from public.post_target_approvals a using stale s where a.post_target_id = s.id returning a.post_target_id
  )
  update public.post_targets t set status = 'awaiting_approval' from cleared c where t.id = c.post_target_id;
  return null;
end;
$$;
revoke all on function public.post_targets_recheck_approval() from public, anon, authenticated, service_role;
drop trigger post_targets_recheck_approval on public.post_targets;
create trigger post_targets_recheck_approval
  after update of title, body_override, hashtags, social_account_id, quote_post_id on public.post_targets
  for each row execute function public.post_targets_recheck_approval();
create trigger media_files_recheck_approval
  after insert or update of post_id, position, removed_at or delete on public.media_files
  for each row execute function public.post_targets_recheck_approval();

-- ===== L1: 送り直し =====
-- 20261116120000_auto_post_engine の写し。判定を posts.auto_created にし、承認はいまの指紋と同じものだけを数える
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

-- ===== L1: 送信ジョブの二重の守り =====
-- 20261112130000_post_hashtags の写し。自動で作った投稿の X・TikTok・YouTube は、いまの指紋と同じ承認の記録がなければ取り出さない
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

-- ===== DB-L3 =====
revoke all on function public.project_events_limit() from public, anon, authenticated, service_role;
