-- Google Play のつなぎの上限に、全員を合わせた上限を足す（20261011340100 の続き。2026-10-11、セキュリティの確認の 3 回目の指摘を受けて）。
-- 利用者ごとの上限（3 つ・30 日に 5 回）は、メールアドレスを変えて登録し直すと何人分でも使える。Google Cloud のプロジェクトの
-- サービスアカウントは既定 100 個（消したものも 30 日は数えられることがある）なので、直近 30 日に作った数を全員で 80 までにして、
-- 100 個を使い切ってほかの人が二度とつなげなくなることは防ぐ。80 に達したら、運営者が様子を見て上限を引き上げるか、悪用を止める
-- （docs/deploy.md の 15）

create or replace function public.check_play_connection_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active integer;
  v_recent integer;
  v_all integer;
begin
  -- 全員の分を数えるので、利用者ごとではなく 1 つの鍵で順にする（つなぐのはまれなので、待ちは問題にならない）
  perform pg_advisory_xact_lock(hashtext('play_connections:all'));
  select count(*) into v_active from public.play_connections where owner_id = new.owner_id;
  if v_active >= 3 then
    raise exception 'play_connection_limit' using errcode = 'P0001', hint = 'Google Play をつなげるのは 3 つのプロジェクトまでです';
  end if;
  select count(*) into v_recent from public.play_account_creations where owner_id = new.owner_id and created_at > now() - interval '30 days';
  if v_recent >= 5 then
    raise exception 'play_connection_rate' using errcode = 'P0001', hint = 'Google Play のつなぎ直しが続いています';
  end if;
  select count(*) into v_all from public.play_account_creations where created_at > now() - interval '30 days';
  if v_all >= 80 then
    raise exception 'play_connection_capacity' using errcode = 'P0001', hint = 'Google Play のつなぎが混み合っています';
  end if;
  insert into public.play_account_creations (owner_id) values (new.owner_id);
  return new;
end;
$$;

revoke execute on function public.check_play_connection_limits() from public, anon, authenticated;

create index play_account_creations_created_idx on public.play_account_creations (created_at);
