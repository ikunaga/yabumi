-- X など「確認して送る」SNS の押し忘れ（2026-11-25・26 本番で、確認が押されず X に送られなかった。PM の了承 2026-11-28）
-- 1. send_expired_auto_target: 確認できないまま送る時刻を過ぎた配信先を、過ぎてから 24 時間以内なら「今すぐ送る」。
--    利用者が確認の画面で本文と画像を見てから押す（指紋が、見た中身と同じときだけ）。承認を記録して pending に戻し、送信ジョブが次の回に送る。
--    二度押し: 条件つきの update（status = 'failed' のときだけ）で、2 回目は「見つからない」で断る
-- 2. notification_log の種類に auto_expired（過ぎて送れなかったことの知らせ。プッシュとメール。配信停止は k=auto）
-- 過ぎた印は error_message（remind.ts の EXPIRED_MESSAGE と同じ文。settleApprovals が入れる）。文を変えるときは両方を変える

create or replace function public.send_expired_auto_target(p_target_id uuid, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_current text;
  v_planned timestamptz;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- 運営者が止めている間・回し方を運営者が止めている回は、送らない（auto_approve_target と同じ）
  if public.auto_post_held(v_uid) then
    raise exception 'auto post held' using errcode = '42501', hint = 'auto_post_hold';
  end if;
  if exists (
    select 1 from public.post_targets t
      join public.posts p on p.id = t.post_id
      join public.auto_runs r on r.id = p.auto_run_id
      join public.auto_plans a on a.id = r.plan_id
     where t.id = p_target_id and t.owner_id = v_uid and a.stop_reason = 'operator'
  ) then
    raise exception 'stopped by operator' using errcode = '42501', hint = 'auto_plan_operator_stop';
  end if;
  select public.post_target_approval_fingerprint(t.id), p.planned_at
    into v_current, v_planned
    from public.post_targets t join public.posts p on p.id = t.post_id
   where t.id = p_target_id
     and t.owner_id = v_uid
     and t.status = 'failed'
     -- 2026-11-28 に文を変えた。前の文の行も受け付ける（engine.ts・remind.ts の EXPIRED_MESSAGE）
     and t.error_message in (
       '確認しないまま送る時刻を過ぎたので、送りませんでした。送るときは、日時を変えて確認してください。',
       '確認できないまま送る時刻を過ぎたので、送りませんでした。送るときは、日時を直して確認してください。'
     )
     and p.auto_created
     and p.status = 'scheduled'
     and public.is_review_sns(t.sns)
   for update of t;
  if v_current is null then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
  -- 過ぎてから 24 時間まで（時刻はサーバーで見る）
  if v_planned is null or v_planned > now() or v_planned < now() - interval '24 hours' then
    raise exception 'send window over' using errcode = 'P0001', hint = 'expired_window_over';
  end if;
  if p_fingerprint is distinct from v_current then
    raise exception 'content changed' using errcode = 'P0001', hint = 'content_changed';
  end if;
  insert into public.post_target_approvals (post_target_id, owner_id, fingerprint) values (p_target_id, v_uid, v_current)
  on conflict (post_target_id) do update set fingerprint = excluded.fingerprint, approved_at = now();
  update public.post_targets t
     set status = 'pending', error_message = null, attempts = 0, next_attempt_at = null, locked_at = null, updated_at = now()
   where t.id = p_target_id and t.status = 'failed';
  if not found then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.send_expired_auto_target(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_expired_auto_target(uuid, text) to authenticated;

alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (
  kind in ('behind', 'weekly', 'overdue', 'auto_held', 'auto_review', 'auto_remind', 'auto_stop', 'auto_hold', 'auto_release', 'auto_failed', 'auto_expired')
);
