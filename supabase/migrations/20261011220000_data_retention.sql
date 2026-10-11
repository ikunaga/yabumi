-- データの保存期間と削除（docs/architecture.md の 4.14、決定 D17）。
-- 費用の記録は退会しても匿名で残し、会話は 1 年、費用の記録は 13 か月で自動で消す。利用者が自分の会話を消せるようにする。

-- ===== 費用の記録は、退会したら紐づけを外して残す =====
-- 月の全体の上限の計算と、費用の記録に要るため。会話や投稿の中身は含まない
alter table public.ai_usage alter column owner_id drop not null;
alter table public.ai_usage drop constraint ai_usage_owner_id_fkey;
alter table public.ai_usage add constraint ai_usage_owner_id_fkey
  foreign key (owner_id) references auth.users (id) on delete set null;

alter table public.sns_api_usage alter column owner_id drop not null;
alter table public.sns_api_usage drop constraint sns_api_usage_owner_id_fkey;
alter table public.sns_api_usage add constraint sns_api_usage_owner_id_fkey
  foreign key (owner_id) references auth.users (id) on delete set null;

comment on column public.ai_usage.owner_id is '使った人。退会すると空になる（費用の記録は 13 か月残す）';
comment on column public.sns_api_usage.owner_id is '使った人。退会すると空になる（費用の記録は 13 か月残す）';

-- ===== 利用者が自分の会話を消す =====
-- 会話（ai_messages）はカスケードで消え、利用量の記録は thread_id が空になる
create policy "ai_threads_delete_own" on public.ai_threads
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ===== 期限を過ぎたデータを消す =====
-- 会話: 最後のやり取り（updated_at。返事のたびに更新している）から 1 年
-- 費用の記録（ai_usage、sns_api_usage）: 13 か月
create function public.purge_expired_data()
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
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;

-- 毎日 3:30（日本時間）。HTTP を通さず DB の中で直接消す
select cron.schedule('yabumi-purge-expired-data', '30 18 * * *', $$select public.purge_expired_data()$$);
