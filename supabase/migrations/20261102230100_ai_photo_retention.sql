-- AI の画像の記録（ai_image_jobs）を、ai_usage と同じ扱いにする（docs/architecture.md の 4.14・4.25 の ②）。
-- 退会したら紐づけを外して残し（全体の月の上限の計算に要る。退会して数え直させない）、13 か月で消す。指示文や画像の中身は入っていない
alter table public.ai_image_jobs alter column owner_id drop not null;
alter table public.ai_image_jobs drop constraint ai_image_jobs_owner_id_fkey;
alter table public.ai_image_jobs add constraint ai_image_jobs_owner_id_fkey
  foreign key (owner_id) references auth.users (id) on delete set null;

comment on column public.ai_image_jobs.owner_id is '使った人。退会すると空になる（費用の記録は 13 か月残す）';

-- 残すのは数・費用・モデル・日時だけにする。候補の置き場所（パスに利用者の ID が入る）は記録に要らないので持たない。
-- 絵の説明・投稿の文は、はじめから保存しない。project_id はプロジェクトを消すと（退会のときも）空になる
alter table public.ai_image_jobs drop column storage_paths;

-- 期限を過ぎたデータを消す（いちばん新しい定義 20261011340100 に、ai_image_jobs の 13 か月の 1 行だけを足す）
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
  delete from public.ai_image_jobs where created_at < now() - interval '13 months';
  delete from public.pending_page_choices where expires_at < now();
  delete from public.link_clicks where clicked_at < now() - interval '90 days';
  delete from public.link_hash_salts where day < (now() at time zone 'Asia/Tokyo')::date - 1;
  delete from public.play_account_creations where created_at < now() - interval '30 days';
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;
