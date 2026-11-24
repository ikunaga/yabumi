-- 自動投稿の回を作れなかった（やり直しても駄目で飛ばした）ことを、メールでも知らせる（2026-11-24 本番で黙って飛ばした。オーナーの指示「二度と起きないように」）。
-- 送った知らせの記録（notification_log）の種類に auto_failed を足す。中身は前の自動投稿の知らせと同じ（設定の名前・送る日時・送り先の SNS。本文は入れない）
alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('behind', 'weekly', 'overdue', 'auto_held', 'auto_review', 'auto_remind', 'auto_stop', 'auto_hold', 'auto_release', 'auto_failed'));
