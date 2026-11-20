-- 予約済みの自動の投稿を、その日だけ飛ばす（2026-11-21 オーナーの指摘。予約済みの投稿の画面の「この日の投稿を飛ばす」）。
-- skip_next_auto_run は回し方の「次の回」を飛ばす。これは画面で開いている 1 つの回を飛ばす。
-- 回を canceled（user_skipped）にし、投稿を下書きに戻す（auto_cancel_unsent_runs と同じ）。
-- 断るもの: 本人の回でない・予約済み（scheduled）か確認待ち（review）でない・送る時刻を過ぎた・どれかの SNS に送り始めた
create function public.skip_scheduled_auto_run(p_run_id uuid)
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
