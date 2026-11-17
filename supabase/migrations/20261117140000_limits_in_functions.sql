-- セキュリティ確認（7121224 以降）の DB-L2: サーバー専用の関数で、上限の値を呼び出す側から渡していた（YouTube・動画。同じ形の画像の引換券も一緒に直す。2026-11-17 PM の指示）。
-- 上限を関数の中の定数にし、引数から外す（reserve_ai_usage・reserve_ai_images と同じ作り）。TS の値とはテストでそろえる
-- （tests/limits-in-functions.test.ts）。上限を変えるときは、このファイルのあとにマイグレーションを足し、TS の値も一緒に直す。
-- p_scope_owner: 全体の上限を、その利用者の分だけで数える（結合テストで、同じ DB のほかのテストに左右されないため。アプリからは渡さない。
-- 呼べるのは service_role だけ。ai_image_quota と同じ考え方）
-- 関数の形が変わるので、前の形を消してから作り直す（同じ名前で引数の違う関数が 2 つ残らないように）

drop function public.reserve_youtube_upload(uuid, uuid, integer, integer);
drop function public.issue_video_upload_ticket(uuid, text, integer, integer, bigint, bigint, integer, bigint);
drop function public.video_upload_check(uuid, integer, integer, bigint, bigint, integer, bigint);
drop function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint);

-- ===== YouTube のアップロード（20261115110000 の reserve_youtube_upload と同じ数え方） =====
-- 全体 90 本（Google の 1 日 100 本から、手での試しや余りの 10 本を引いた数。src/lib/sns/youtube/config.ts の YOUTUBE_GLOBAL_DAILY_UPLOADS）、
-- 利用者ごと 5 本（YOUTUBE_USER_DAILY_UPLOADS）。割り当ての監査で枠が増えたら、マイグレーションで上げる
create function public.reserve_youtube_upload(
  p_owner_id uuid,
  p_post_target_id uuid,
  p_scope_owner uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_global_daily constant integer := 90;
  c_user_daily constant integer := 5;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  v_all integer;
  v_mine integer;
begin
  if p_owner_id is null then
    raise exception 'owner is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('youtube_upload_quota'));
  select count(*) filter (where p_scope_owner is null or owner_id = p_scope_owner), count(*) filter (where owner_id = p_owner_id)
    into v_all, v_mine
    from public.sns_api_usage
   where sns = 'youtube' and operation = 'upload' and created_at >= v_day_start;
  if v_all >= c_global_daily then
    return 'global';
  end if;
  if v_mine >= c_user_daily then
    return 'user';
  end if;
  insert into public.sns_api_usage (owner_id, sns, post_target_id, operation, cost_usd)
  values (p_owner_id, 'youtube', p_post_target_id, 'upload', 0);
  return 'ok';
end;
$$;
comment on function public.reserve_youtube_upload(uuid, uuid, uuid) is 'YouTube のアップロード 1 本ぶんを取る（太平洋時間の 1 日。全体 90 本・利用者ごと 5 本。上限は関数の中の定数）。ok / global / user を返す。サーバーだけ';
revoke all on function public.reserve_youtube_upload(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reserve_youtube_upload(uuid, uuid, uuid) to service_role;

-- ===== 動画の引換券（20261115100000 の video_upload_check・issue_video_upload_ticket と同じ数え方） =====
-- 確かめ待ち 2 本・添えていない動画 3 本・1 人 300MB・1 本 50MB・月 20 本・全体 500MB（src/lib/media/video-rules.ts の値）
create function public.video_upload_check(
  p_owner_id uuid,
  p_scope_owner uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_max_pending constant integer := 2;
  c_max_unattached constant integer := 3;
  c_quota_bytes constant bigint := 314572800;
  c_max_file_bytes constant bigint := 52428800;
  c_month_limit constant integer := 20;
  c_global_quota_bytes constant bigint := 524288000;
  v_month date := date_trunc('month', now() at time zone 'Asia/Tokyo')::date;
  v_pending integer;
  v_unattached integer;
  v_used bigint;
  v_count integer;
  v_global bigint;
begin
  select count(*) into v_pending
    from public.media_upload_tickets
   where owner_id = p_owner_id and kind = 'video' and consumed_at is null and created_at > now() - interval '1 day';
  if v_pending >= c_max_pending then
    return 'too_many_pending';
  end if;

  select count(*) into v_unattached
    from public.media_files
   where owner_id = p_owner_id and kind = 'video' and post_id is null;
  if v_unattached + v_pending >= c_max_unattached then
    return 'too_many_unattached';
  end if;

  select coalesce(sum(size_bytes), 0) into v_used
    from public.media_files
   where owner_id = p_owner_id and kind = 'video' and removed_at is null;
  v_used := v_used + public.video_orphan_bytes(p_owner_id);
  if v_used + (v_pending + 1) * c_max_file_bytes > c_quota_bytes then
    return 'quota';
  end if;

  select coalesce((select c.count from public.video_upload_counts c where c.owner_id = p_owner_id and c.month = v_month), 0) into v_count;
  if v_count + v_pending >= c_month_limit then
    return 'month_limit';
  end if;

  select coalesce(sum(size_bytes), 0) into v_global
    from public.media_files
   where kind = 'video' and removed_at is null and (p_scope_owner is null or owner_id = p_scope_owner);
  v_global := v_global + public.video_orphan_bytes(p_scope_owner)
    + (select count(*) from public.media_upload_tickets
        where kind = 'video' and consumed_at is null and created_at > now() - interval '1 day'
          and (p_scope_owner is null or owner_id = p_scope_owner)) * c_max_file_bytes;
  if v_global + c_max_file_bytes > c_global_quota_bytes then
    return 'global_quota';
  end if;
  return 'ok';
end;
$$;

-- 上限の確かめと引換券の記録を 1 つの処理で（利用者ごとのロックと全体の量のロックの中で、video_upload_check を通してから記録する）
create function public.issue_video_upload_ticket(
  p_owner_id uuid,
  p_storage_path text,
  p_scope_owner uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_storage_path not like p_owner_id::text || '/%.mp4' then
    raise exception 'invalid storage path' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('media_upload:' || p_owner_id::text));
  perform pg_advisory_xact_lock(hashtext('video_upload:global'));

  v_status := public.video_upload_check(p_owner_id, p_scope_owner);
  if v_status <> 'ok' then
    return v_status;
  end if;
  insert into public.media_upload_tickets (owner_id, storage_path, kind) values (p_owner_id, p_storage_path, 'video');
  return 'ok';
end;
$$;

revoke all on function public.video_upload_check(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.video_upload_check(uuid, uuid) to service_role;
revoke all on function public.issue_video_upload_ticket(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.issue_video_upload_ticket(uuid, text, uuid) to service_role;

-- ===== 画像の引換券（20261115100000 の issue_media_upload_ticket と同じ数え方） =====
-- 確かめ待ち 10 枚・添えていない画像 20 枚・1 人 100MB・1 枚 4MB（src/lib/media/store.ts の MAX_PENDING_TICKETS、src/lib/media/rules.ts の値）
create function public.issue_media_upload_ticket(
  p_owner_id uuid,
  p_storage_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_pending constant integer := 10;
  c_max_unattached constant integer := 20;
  c_quota_bytes constant bigint := 104857600;
  c_max_file_bytes constant bigint := 4194304;
  v_pending integer;
  v_unattached integer;
  v_used bigint;
  v_held bigint;
begin
  perform pg_advisory_xact_lock(hashtext('media_upload:' || p_owner_id::text));

  select count(*) into v_pending
    from public.media_upload_tickets
   where owner_id = p_owner_id and kind = 'image' and consumed_at is null and created_at > now() - interval '1 day';
  if v_pending >= c_max_pending then
    return 'too_many_pending';
  end if;

  select count(*) into v_unattached
    from public.media_files
   where owner_id = p_owner_id and kind = 'image' and post_id is null and note_id is null and source_of is null;
  if v_unattached + v_pending >= c_max_unattached then
    return 'too_many_unattached';
  end if;

  -- 量に数えるもの: 確かめ待ちの引換券（1 枚あたりの上限の大きさで）と、使った引換券の場所に残っている記録のないファイル（実際の大きさ）。動画と同じ
  select coalesce(sum((o.metadata->>'size')::bigint), 0) into v_held
    from public.media_upload_tickets k
    join storage.objects o on o.bucket_id = 'post-media' and o.name = k.storage_path
   where k.owner_id = p_owner_id and k.kind = 'image' and k.consumed_at is not null
     and not exists (select 1 from public.media_files m where m.storage_path = k.storage_path);

  select coalesce(sum(size_bytes), 0) into v_used from public.media_files where owner_id = p_owner_id and kind = 'image';
  if v_used + v_held + (v_pending + 1) * c_max_file_bytes > c_quota_bytes then
    return 'quota';
  end if;

  insert into public.media_upload_tickets (owner_id, storage_path) values (p_owner_id, p_storage_path);
  return 'ok';
end;
$$;

revoke all on function public.issue_media_upload_ticket(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.issue_media_upload_ticket(uuid, text) to service_role;
