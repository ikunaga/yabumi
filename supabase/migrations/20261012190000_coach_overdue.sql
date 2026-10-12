-- 伴走（4.27）: 予定日を過ぎたやること（ロードマップ。20261012160000）を、遅れそうなときの声かけに入れる。
-- 同じやることは 1 回だけ知らせるので、送った記録の種類に overdue を足す（period_key はやることの ID）
alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (kind in ('behind', 'weekly', 'overdue'));
