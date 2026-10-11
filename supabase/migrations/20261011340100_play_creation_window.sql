-- Google Play のつなぎの、作る回数の上限を強める（20261011330000 の続き。2026-10-11、セキュリティの確認の 2 回目の指摘を受けて）。
-- ① Google Cloud では、消したサービスアカウントも 30 日間は復元できる状態で残り、プロジェクトの上限に数えられることがある。
--    「1 日 5 回」だと毎日繰り返して 1 か月で 150 個になり、全員で分け合う 100 個を使い切れるので、「直近 30 日で 5 回」にする
-- ② 作った記録が退会で一緒に消えると、退会して登録し直せば数え直しになる。記録は利用者の ID と日時だけなので、
--    退会しても 30 日は残す（外部キーを外す）。30 日を過ぎたら purge_expired_data が消す

alter table public.play_account_creations drop constraint play_account_creations_owner_id_fkey;

create or replace function public.check_play_connection_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
  v_recent integer;
begin
  perform pg_advisory_xact_lock(hashtext('play_connections:' || new.owner_id::text));
  select count(*) into v_active from public.play_connections where owner_id = new.owner_id;
  if v_active >= 3 then
    raise exception 'play_connection_limit' using errcode = 'P0001', hint = 'Google Play をつなげるのは 3 つのプロジェクトまでです';
  end if;
  select count(*) into v_recent from public.play_account_creations where owner_id = new.owner_id and created_at > now() - interval '30 days';
  if v_recent >= 5 then
    raise exception 'play_connection_rate' using errcode = 'P0001', hint = 'Google Play のつなぎ直しが続いています';
  end if;
  insert into public.play_account_creations (owner_id) values (new.owner_id);
  return new;
end;
$$;

revoke execute on function public.check_play_connection_limits() from public, anon, authenticated;

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
  delete from public.play_account_creations where created_at < now() - interval '30 days';
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;
