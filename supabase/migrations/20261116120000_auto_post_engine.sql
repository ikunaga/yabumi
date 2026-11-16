-- 自動の投稿のジョブ（feat/auto-post-engine。docs/design/auto-post.md の 2.3・2.7。2026-11-16 PM が計画を了承）。
-- 1. claim_due_auto_runs に、取り出す利用者を絞る引数（p_owner_ids）を足す（結合テストが共有のローカル DB のほかの人の回を取り出さないため。ジョブは渡さない）
-- 2. requeue_failed_targets: 自動の回の投稿で、確かめが要る SNS（X・TikTok・YouTube）の配信先は、承認の記録がなければ pending ではなく確かめ待ちに戻す
--    （送る時刻を過ぎて失敗にした確かめ待ちを「送り直す」で、承認なしに送れないように。ジョブの側と二重に守る。2026-11-16 PM の指示）
-- 3. auto_runs に知らせた時刻（notified_at: 作ったときの知らせ、reminded_at: 確かめ待ちの 2 時間前の知らせ）
-- 4. notification_prefs に自動の投稿のスマホの通知（auto_post_push。既定はオン）
-- 5. pg_cron: 自動の投稿のジョブ（10 分ごと）と、回・承認の記録（13 か月）・お知らせの予定（日付から 1 年）の片付け（毎日）。
--    ジョブは環境変数 AUTO_POST_ENABLED が "true" のときだけ動く（既定は止まっている。deploy.md の 31）

-- ===== 1. 作る回の取り出し（利用者を絞れる形に） =====
drop function public.claim_due_auto_runs(integer);
create function public.claim_due_auto_runs(p_limit integer default 5, p_owner_ids uuid[] default null)
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

-- ===== 2. 送り直し =====
-- 20261003120000_publish_jobs の定義の写し。確かめが要る SNS の自動の回の配信先で、承認の記録がないものだけ awaiting_approval に戻す分岐を足す
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
          when t.sns in ('x', 'tiktok', 'youtube')
           and exists (select 1 from public.posts p where p.id = t.post_id and p.auto_run_id is not null)
           and not exists (select 1 from public.post_target_approvals a where a.post_target_id = t.id)
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

-- ===== 3. 知らせた時刻 =====
alter table public.auto_runs add column notified_at timestamptz;
alter table public.auto_runs add column reminded_at timestamptz;
comment on column public.auto_runs.notified_at is '作ったこと（明日送ること・確かめ待ち・下書きに回したこと）を知らせた時刻';
comment on column public.auto_runs.reminded_at is '確かめ待ちを、送る時刻の 2 時間前にもう一度知らせた時刻';

-- ===== 4. 通知の設定 =====
alter table public.notification_prefs add column auto_post_push boolean not null default true;
comment on column public.notification_prefs.auto_post_push is '自動の投稿のスマホの通知（作った・確かめ待ち・止まった）。行がなければオン';
grant update (auto_post_push) on public.notification_prefs to authenticated;
grant insert (auto_post_push) on public.notification_prefs to authenticated;

-- ===== 5. ジョブと片付け =====
select cron.schedule('yabumi-auto-post', '*/10 * * * *', $$select public.invoke_job('/api/jobs/auto-post')$$);
select cron.schedule('yabumi-purge-auto-post', '50 18 * * *', $$
  delete from public.auto_runs where created_at < now() - interval '13 months';
  delete from public.post_target_approvals where approved_at < now() - interval '13 months';
  delete from public.project_events where on_date < (now() at time zone 'Asia/Tokyo')::date - 365;
$$);
