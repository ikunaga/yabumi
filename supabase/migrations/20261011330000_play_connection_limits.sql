-- Google Play のつなぎの数の上限（docs/architecture.md の 4.22、段取り ⑤ の続き。2026-10-11、セキュリティの確認の指摘を受けて）。
-- 利用者ごとのサービスアカウントは、オーナーの Google Cloud のプロジェクトで既定 100 個まで。1 人がプロジェクトを作っては
-- 「Google Play をつなぐ」を繰り返すと、ほかの人がつなげなくなる。そこで、1 人がつなげる数（3）と、1 日（直近 24 時間）に
-- 作れる数（5。外して作り直す分も数える）を、play_connections に入れるときに DB の中で順に確かめる

-- 作った記録（外しても残す。24 時間を過ぎたものは片付けで消す）。サーバーだけ
create table public.play_account_creations (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index play_account_creations_owner_idx on public.play_account_creations (owner_id, created_at);

alter table public.play_account_creations enable row level security;
revoke all on public.play_account_creations from anon, authenticated;

create function public.check_play_connection_limits()
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
  select count(*) into v_recent from public.play_account_creations where owner_id = new.owner_id and created_at > now() - interval '24 hours';
  if v_recent >= 5 then
    raise exception 'play_connection_rate' using errcode = 'P0001', hint = 'Google Play のつなぎ直しが続いています';
  end if;
  insert into public.play_account_creations (owner_id) values (new.owner_id);
  return new;
end;
$$;

revoke execute on function public.check_play_connection_limits() from public, anon, authenticated;

create trigger play_connections_limits
  before insert on public.play_connections
  for each row execute function public.check_play_connection_limits();

-- 期限を過ぎたデータの自動の削除に、24 時間を過ぎた作った記録を足す（戻り値の形は変えない。270100 の定義を引き継ぐ）
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
  delete from public.play_account_creations where created_at < now() - interval '1 day';
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;
