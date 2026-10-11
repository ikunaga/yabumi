-- 期限を過ぎたデータの自動の削除（4.14）に、短縮リンクのクリックの記録を足す（4.22、決定 D20）。
-- 20261011260000（Instagram・Facebook）の定義を引き継ぎ、戻り値の形は変えない（消した件数を返すのは今までの 3 つだけ）
-- - 1 クリックの記録は 90 日で消す（日ごとの集計 link_click_daily は残る）
-- - ハッシュの塩は、昨日より前のものを消す（日をまたいで同じ人とわからないように。日付の境目の重複の判定のため、昨日の分だけ残す）
create or replace function public.purge_expired_data()
returns table (ai_threads_deleted integer, ai_usage_deleted integer, sns_api_usage_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threads integer;
  v_ai_usage integer;
  v_sns_usage integer;
begin
  delete from public.ai_threads where updated_at < now() - interval '1 year';
  get diagnostics v_threads = row_count;
  delete from public.ai_usage where created_at < now() - interval '13 months';
  get diagnostics v_ai_usage = row_count;
  delete from public.sns_api_usage where created_at < now() - interval '13 months';
  get diagnostics v_sns_usage = row_count;
  delete from public.pending_page_choices where expires_at < now();
  delete from public.link_clicks where clicked_at < now() - interval '90 days';
  delete from public.link_hash_salts where day < (now() at time zone 'Asia/Tokyo')::date - 1;
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;
