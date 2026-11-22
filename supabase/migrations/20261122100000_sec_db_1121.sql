-- セキュリティの確認（docs/security/2026-11-21_セキュリティ確認.md）のうち、DB だけで直せるもの（M2・L7・L10・L11）。2026-11-22 オーナーの了承

-- ===== M2: 飛ばす・止めると、送信のジョブ（claim_due_targets）が同時に動いても食い違わないようにする =====
-- 前は post_targets を取らずに「送り始めていないか」を見ていた。ジョブとほぼ同時だと、飛ばした（下書き）のに SNS に送られることがあった。
-- いまは、確かめる前に post_targets を for update で取る。ジョブが先に取っていれば、その終わりを待ってから見るので「送信中」と分かる。
-- ジョブは skip locked なので、こちらが先に取っていれば飛ばし、投稿が下書きになったあとは拾わない（p.status = 'scheduled' だけを拾う）

-- 止める処理の本体（set_auto_plan_status・operator_hold_auto_post・skip_scheduled_auto_run が呼ぶ）。
-- 下書きに戻すときは、先に投稿の post_targets を取る。送り始めた投稿の回は「止めた」にしない（送られる投稿を「飛ばした」と見せないため）
create or replace function public.auto_cancel_unsent_runs(p_uid uuid, p_run_ids uuid[], p_to_draft boolean, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_to_draft then
    perform 1 from public.post_targets t
      join public.auto_runs r on r.post_id = t.post_id
     where r.id = any(p_run_ids) and r.owner_id = p_uid and r.status in ('scheduled', 'review')
     order by t.id
       for update of t;
    update public.posts p set status = 'draft', updated_at = now()
      from public.auto_runs r
     where r.id = any(p_run_ids) and r.owner_id = p_uid and r.post_id = p.id
       and r.status in ('scheduled', 'review')
       and not exists (select 1 from public.post_targets t where t.post_id = p.id and t.status not in ('pending', 'awaiting_approval'));
  end if;
  update public.auto_runs r set status = 'canceled', reason = p_reason, updated_at = now()
   where r.id = any(p_run_ids) and r.owner_id = p_uid
     and (r.status = 'waiting'
          or (p_to_draft and r.status in ('scheduled', 'review')
              and not exists (select 1 from public.post_targets t where t.post_id = r.post_id and t.status not in ('pending', 'awaiting_approval')))
          or (not p_to_draft and r.status = 'review'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.auto_cancel_unsent_runs(uuid, uuid[], boolean, text) from public, anon, authenticated, service_role;

create or replace function public.skip_scheduled_auto_run(p_run_id uuid)
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
  select r.id, r.post_id, r.due_at into v_run from public.auto_runs r
   where r.id = p_run_id and r.owner_id = v_uid and r.status in ('scheduled', 'review') and r.due_at > now()
   for update;
  if v_run.id is null then
    raise exception 'run not found' using errcode = 'P0002';
  end if;
  -- 確かめる前に post_targets を取る（M2）。ジョブが送り始めていれば、その終わりを待ってから見る
  if v_run.post_id is not null then
    perform 1 from public.post_targets t where t.post_id = v_run.post_id order by t.id for update;
  end if;
  -- 送り始めた（送信中・投稿済みなど）SNS があれば飛ばさない（下書きに戻せず、回の記録と食い違うため）
  if v_run.post_id is not null and exists (
    select 1 from public.post_targets t where t.post_id = v_run.post_id and t.status not in ('pending', 'awaiting_approval')
  ) then
    raise exception 'already sending' using errcode = 'P0001', hint = 'auto_run_sending';
  end if;
  perform public.auto_cancel_unsent_runs(v_uid, array[v_run.id], true, 'user_skipped');
  return v_run.due_at;
end;
$$;
revoke all on function public.skip_scheduled_auto_run(uuid) from public, anon, authenticated, service_role;
grant execute on function public.skip_scheduled_auto_run(uuid) to authenticated;

-- 送信のジョブの側。送り先の行に加えて投稿の行も取る（ほかは 20261118100000_auto_post_holds と同じ）
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
     -- 投稿の行も取る（M2）。飛ばす・止めるが投稿を下書きにしてから終わると、ここで投稿の新しい状態を見直して拾わない
     -- （送り先の行だけを取ると、待ったあとの見直しで、投稿は始めに読んだ「予約中」のまま使われ、下書きにした投稿を送ってしまう）
     for update of t skip locked
     for share of p skip locked
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

-- ===== L7: 自動投稿の分の画像の予約も、運営者が止めている人には断る =====
create or replace function public.reserve_ai_images(
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
  -- 運営者が利用者ごとに止めている間は、自動投稿の分の画像を断る（L7。reserve_ai_usage と同じ。文の予約が先に断るが、ここでも断る）
  if p_auto and public.auto_post_held(p_owner_id) then
    return query select null::uuid, 'auto_post_hold'::text, 0, 0, null::timestamptz, 0::numeric;
    return;
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

-- ===== L10: 古い形の save_auto_plan（口調の指示 p_tone）を消す（docs/deploy.md の 33-2。アプリは新しい形だけを呼ぶ） =====
drop function if exists public.save_auto_plan(uuid, uuid, text, text, jsonb, jsonb, text, jsonb, text, integer, boolean);

-- ===== L11: auto_instructions_clean は、中で使うだけ（save_auto_plan・set_auto_plan_instructions。どちらも security definer）=====
revoke all on function public.auto_instructions_clean(jsonb) from public, anon, authenticated, service_role;
