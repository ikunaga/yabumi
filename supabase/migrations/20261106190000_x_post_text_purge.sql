-- X で人気の投稿から出したネタの会話に残る、他人の投稿の文を 1 日ほどで消す（セキュリティ確認 2026-11-06 の L3。docs/architecture.md の 4.52）。
-- X の開発者規約（Developer Policy の Content compliance）は、X Content を保存するなら X の今の状態に合わせて保つ（消された・鍵付きになった投稿は消す）ことを求める。
-- yabumi は X の状態を追いかけないので、持たないことで満たす: ai_messages の ideas_request の xPost.text（貼った・選んだ投稿の文）と interest（気になったところ）を、
-- 作ってから 24 時間たったら空にする。URL と投稿の id は残す（引用の下書きと「元にした投稿」のリンクに使う）。A（yabumi の中で探した）と B（利用者が写した）は見分けない。
-- 毎日の purge_expired_data で消すので、消えるまでは最大で 2 日弱。済んだ会話（ai_messages_reject_closed）はネタ出しにはないが、念のため避ける

-- 期限を過ぎたデータを消す（いちばん新しい定義 20261106140000_x_search_usage に、X の投稿の文を空にする 1 文だけを足す）
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
  delete from public.x_search_usage where created_at < now() - interval '13 months';
  update public.ai_messages m
     set content = jsonb_set(jsonb_set(m.content, '{xPost,text}', '""'::jsonb), '{xPost,interest}', '""'::jsonb)
   where m.role = 'user'
     and m.content ->> 'kind' = 'ideas_request'
     and m.content ->> 'source' = 'x_post'
     and jsonb_typeof(m.content -> 'xPost') = 'object'
     and (coalesce(m.content -> 'xPost' ->> 'text', '') <> '' or coalesce(m.content -> 'xPost' ->> 'interest', '') <> '')
     and m.created_at < now() - interval '24 hours'
     and exists (select 1 from public.ai_threads t where t.id = m.thread_id and t.purpose = 'post_ideas' and t.closed_at is null);
  delete from public.pending_page_choices where expires_at < now();
  delete from public.link_clicks where clicked_at < now() - interval '90 days';
  delete from public.link_hash_salts where day < (now() at time zone 'Asia/Tokyo')::date - 1;
  delete from public.play_account_creations where created_at < now() - interval '30 days';
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;
