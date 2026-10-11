-- 画像のアップロード URL の発行を、上限の確認と引換券の記録を 1 つの処理にまとめて行う（docs/architecture.md の 4.18）。
-- 確認（数える）と記録（insert）を別々に行うと、同時にたくさん頼まれたときに、どれも「まだ上限の手前」と判断して
-- 上限を超えて発行してしまう。利用者ごとのアドバイザリロックで順に処理し、確かめ待ちの引換券も 1 枚あたりの上限の大きさで
-- 容量に数える（確かめたあとに容量を超えることがないように）。サーバー（service_role）だけが呼ぶ
create function public.issue_media_upload_ticket(
  p_owner_id uuid,
  p_storage_path text,
  p_max_pending integer,
  p_max_unattached integer,
  p_quota_bytes bigint,
  p_max_file_bytes bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending integer;
  v_unattached integer;
  v_used bigint;
begin
  perform pg_advisory_xact_lock(hashtext('media_upload:' || p_owner_id::text));

  select count(*) into v_pending
    from public.media_upload_tickets
   where owner_id = p_owner_id and created_at > now() - interval '1 day';
  if v_pending >= p_max_pending then
    return 'too_many_pending';
  end if;

  select count(*) into v_unattached from public.media_files where owner_id = p_owner_id and post_id is null;
  if v_unattached + v_pending >= p_max_unattached then
    return 'too_many_unattached';
  end if;

  select coalesce(sum(size_bytes), 0) into v_used from public.media_files where owner_id = p_owner_id;
  if v_used + (v_pending + 1) * p_max_file_bytes > p_quota_bytes then
    return 'quota';
  end if;

  insert into public.media_upload_tickets (storage_path, owner_id) values (p_storage_path, p_owner_id);
  return 'ok';
end;
$$;

revoke execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) from public, anon, authenticated;
grant execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) to service_role;
