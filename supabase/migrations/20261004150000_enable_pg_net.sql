-- 本番（Supabase の Free）では pg_net が最初から有効とは限らない。予約ジョブ（invoke_job）が使うので有効にする。
-- ローカルでは最初から入っているので、何も変わらない
create extension if not exists pg_net with schema extensions;
