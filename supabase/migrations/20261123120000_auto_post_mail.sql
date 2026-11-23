-- 自動投稿の大事な知らせを、メールでも送る（2026-11-23 オーナーの指示「メールでも送れるようにして」。PM が案を了承）。
-- スマホの通知は、iPhone ではホーム画面に追加しないと届かないため。docs/design/auto-post.md の 2.7・docs/architecture.md の 4.27
-- 1. notification_prefs.auto_post_email: 自動投稿のメールを受け取るか（既定は受け取る。本人が変えられる列）
-- 2. notification_log に自動投稿のメールの種類を足す。運営者が止めた・解除した知らせはプロジェクトに結びつかないので、project_id を空でもよくし、
--    空どうしも同じものとして二重に送らない（nulls not distinct）。period_key は「回し方の id と止めた時刻」が入るように 80 字まで
-- 預かる情報は増えない（送った記録の種類が増えるだけ。90 日で消すのは今のまま）。メールで送る中身は docs/legal.md の ② の案

alter table public.notification_prefs add column auto_post_email boolean not null default true;
comment on column public.notification_prefs.auto_post_email is '自動投稿の知らせのメール（下書きに残した・1 回目の確認待ち・確認待ちのまま送る時刻が近い・止まった・運営者が止めた／解除した）。行がなければ受け取る';
grant update (auto_post_email) on public.notification_prefs to authenticated;
grant insert (auto_post_email) on public.notification_prefs to authenticated;

alter table public.notification_log alter column project_id drop not null;
alter table public.notification_log drop constraint notification_log_user_id_project_id_kind_period_key_channel_key;
alter table public.notification_log add constraint notification_log_user_id_project_id_kind_period_key_channel_key unique nulls not distinct (user_id, project_id, kind, period_key, channel);
alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (
  kind in ('behind', 'weekly', 'overdue', 'auto_held', 'auto_review', 'auto_remind', 'auto_stop', 'auto_hold', 'auto_release')
);
alter table public.notification_log drop constraint notification_log_period_key_check;
alter table public.notification_log add constraint notification_log_period_key_check check (char_length(period_key) between 1 and 80);
-- 自動投稿のメールは、運営者の止めた・解除した知らせだけ project_id が空（ほかの種類は今までどおりプロジェクトに結びつける）
alter table public.notification_log add constraint notification_log_project_check check (project_id is not null or kind in ('auto_hold', 'auto_release'));
comment on table public.notification_log is '伴走の知らせと自動投稿の知らせを送った記録（4.27）。二重に送らないため。90 日で消す。運営者が自動投稿を止めた・解除した知らせだけ project_id が空';
