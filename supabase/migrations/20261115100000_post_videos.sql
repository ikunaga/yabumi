-- 投稿に動画を添える（docs/design/video.md の 6.・7.。2026-11-15 オーナーが W1〜W6 をおすすめで了承）。
-- 動画は非公開のバケット post-videos の「<利用者の ID>/<乱数>.mp4」に、サーバーが発行する署名つきのトークンでブラウザから直接上げる（TUS）。
-- サーバーが MP4 の箱を確かめてから media_files に kind = 'video' で記録する。利用者が直接読む・書く経路は置かない（画像と同じ）。
-- 1 つの投稿は「画像（10 枚まで）」か「動画 1 本」のどちらか。動画はネタ帳のメモ・画像の整え（元の画像）には使わない。
-- 送り終えた動画は 1 日（送れなかった配信先が残っていれば 7 日）でファイルを消し、行は removed_at を入れて残す（投稿の画面に「消しました」と出すため）。

-- ===== バケット =====
-- 1 本 50MB まで（Supabase Free の 1 ファイルの上限）。MP4 だけ。ポリシーは置かない（上げるのは署名つきのトークン、読むのはサーバーの署名 URL だけ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-videos', 'post-videos', false, 52428800, array['video/mp4'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ===== media_files の列 =====
alter table public.media_files
  add column kind text not null default 'image' check (kind in ('image', 'video')),
  -- 動画の長さ（サーバーが読んだ値）。3〜90 秒はサーバーの定数で確かめ、DB は Pro で広げられるよう 10 分まで受ける
  add column duration_ms integer check (duration_ms is null or duration_ms between 1 and 600000),
  -- 送り終えて動画のファイルを消した時刻（行は投稿と一緒に消える）
  add column removed_at timestamptz;

alter table public.media_files
  add constraint media_files_video_duration check ((kind = 'video') = (duration_ms is not null)),
  add constraint media_files_kind_path check ((kind = 'image' and storage_path like '%.jpg') or (kind = 'video' and storage_path like '%.mp4')),
  -- 動画はネタ帳のメモ・画像の整え（元の画像・直した画像）に使わない
  add constraint media_files_video_plain check (
    kind = 'image' or (note_id is null and source_of is null and original_id is null and edit_base_id is null and edit is null)
  ),
  -- ファイルを消したのは動画だけ（画像は行ごと消す）
  add constraint media_files_removed_video check (removed_at is null or kind = 'video');

-- 1 つの投稿に動画は 1 本
create unique index media_files_one_video on public.media_files (post_id) where kind = 'video' and post_id is not null;

-- 1 つの投稿に画像と動画を混ぜない。書くのはサーバーだけだが、DB でも守る。
-- 同じ投稿に同時に画像と動画を添える 2 つの処理が、どちらも相手を見ないまま入らないよう、投稿ごとのロックで順にする
create function public.media_files_no_mix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.post_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('media_post:' || new.post_id::text));
  if exists (select 1 from public.media_files m where m.post_id = new.post_id and m.kind <> new.kind and m.id <> new.id) then
    raise exception 'a post has either images or one video' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.media_files_no_mix() from public, anon, authenticated, service_role;

create trigger media_files_no_mix
  before insert or update of post_id, kind on public.media_files
  for each row execute function public.media_files_no_mix();

-- 権限は今のまま（本人の行の select だけ。新しい列も RLS で本人の行だけ）。どの環境でも同じになるよう付け直す
revoke all on public.media_files from anon, authenticated;
grant select on public.media_files to authenticated;

-- ===== 引換券の種類 =====
alter table public.media_upload_tickets
  add column kind text not null default 'image' check (kind in ('image', 'video')),
  add constraint media_upload_tickets_kind_path check ((kind = 'image' and storage_path like '%.jpg') or (kind = 'video' and storage_path like '%.mp4'));

-- ===== 月に上げた動画の本数（行は片付けで消えるので別に数える。13 か月で消す）=====
create table public.video_upload_counts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- その月の 1 日（日本時間）
  month date not null,
  count integer not null default 0 check (count >= 0),
  primary key (owner_id, month)
);

-- ポリシーも権限も置かない（サーバーだけが関数から書く）
alter table public.video_upload_counts enable row level security;
revoke all on public.video_upload_counts from anon, authenticated;

-- ===== 動画のアップロードの引換券 =====
-- 上限の確認と引換券の記録を 1 つの処理で（画像の issue_media_upload_ticket と同じ考え方）。利用者ごとのロック（画像と同じ鍵）と、
-- 全体の量のためのロックの中で数える。確かめ待ちの引換券は 1 本あたりの上限（p_max_file_bytes）で量に数える。
-- 月の本数は引換券を出したときに数える（上げずにやめても戻さない。何度も発行して上限の確認を避けられないように）
create function public.issue_video_upload_ticket(
  p_owner_id uuid,
  p_storage_path text,
  p_max_pending integer,
  p_max_unattached integer,
  p_quota_bytes bigint,
  p_max_file_bytes bigint,
  p_month_limit integer,
  p_global_quota_bytes bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'Asia/Tokyo')::date;
  v_pending integer;
  v_unattached integer;
  v_used bigint;
  v_count integer;
  v_global bigint;
  v_global_pending integer;
begin
  if p_storage_path not like p_owner_id::text || '/%.mp4' then
    raise exception 'invalid storage path' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('media_upload:' || p_owner_id::text));
  perform pg_advisory_xact_lock(hashtext('video_upload:global'));

  select count(*) into v_pending
    from public.media_upload_tickets
   where owner_id = p_owner_id and kind = 'video' and created_at > now() - interval '1 day';
  if v_pending >= p_max_pending then
    return 'too_many_pending';
  end if;

  select count(*) into v_unattached
    from public.media_files
   where owner_id = p_owner_id and kind = 'video' and post_id is null;
  if v_unattached + v_pending >= p_max_unattached then
    return 'too_many_unattached';
  end if;

  select coalesce(sum(size_bytes), 0) into v_used
    from public.media_files
   where owner_id = p_owner_id and kind = 'video' and removed_at is null;
  if v_used + (v_pending + 1) * p_max_file_bytes > p_quota_bytes then
    return 'quota';
  end if;

  select coalesce((select c.count from public.video_upload_counts c where c.owner_id = p_owner_id and c.month = v_month), 0) into v_count;
  if v_count >= p_month_limit then
    return 'month_limit';
  end if;

  select coalesce(sum(size_bytes), 0) into v_global from public.media_files where kind = 'video' and removed_at is null;
  select count(*) into v_global_pending from public.media_upload_tickets where kind = 'video' and created_at > now() - interval '1 day';
  if v_global + (v_global_pending + 1) * p_max_file_bytes > p_global_quota_bytes then
    return 'global_quota';
  end if;

  insert into public.media_upload_tickets (owner_id, storage_path, kind) values (p_owner_id, p_storage_path, 'video');
  insert into public.video_upload_counts (owner_id, month, count) values (p_owner_id, v_month, 1)
  on conflict (owner_id, month) do update set count = public.video_upload_counts.count + 1;
  return 'ok';
end;
$$;

revoke all on function public.issue_video_upload_ticket(uuid, text, integer, integer, bigint, bigint, integer, bigint) from public, anon, authenticated, service_role;
grant execute on function public.issue_video_upload_ticket(uuid, text, integer, integer, bigint, bigint, integer, bigint) to service_role;

-- ===== 画像の引換券・容量: 画像だけを数える（動画が画像の枠を食わないように）。それ以外は 20261113150000 と同じ =====
create or replace function public.issue_media_upload_ticket(
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
   where owner_id = p_owner_id and kind = 'image' and created_at > now() - interval '1 day';
  if v_pending >= p_max_pending then
    return 'too_many_pending';
  end if;

  select count(*) into v_unattached
    from public.media_files
   where owner_id = p_owner_id and kind = 'image' and post_id is null and note_id is null and source_of is null;
  if v_unattached + v_pending >= p_max_unattached then
    return 'too_many_unattached';
  end if;

  select coalesce(sum(size_bytes), 0) into v_used from public.media_files where owner_id = p_owner_id and kind = 'image';
  if v_used + (v_pending + 1) * p_max_file_bytes > p_quota_bytes then
    return 'quota';
  end if;

  insert into public.media_upload_tickets (owner_id, storage_path) values (p_owner_id, p_storage_path);
  return 'ok';
end;
$$;

revoke execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) to service_role;

create or replace function public.media_usage_bytes(p_owner_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(size_bytes), 0)::bigint from public.media_files where owner_id = p_owner_id and kind = 'image';
$$;

revoke execute on function public.media_usage_bytes(uuid) from public, anon, authenticated, service_role;
grant execute on function public.media_usage_bytes(uuid) to service_role;

-- ===== 毎日の片付け =====
-- 返す列を足すので作り直す。bucket: どのバケットのファイルか。mark_removed: 行を消さずに removed_at を入れる（送り終えた動画）。
-- 画像（20261113150000 から変えたところ）: 配信先が preparing（SNS の処理待ち）の間も消さない。
-- 動画: ① 投稿に添えないまま 1 日 ② 添えた投稿のどの配信先も pending・preparing・publishing でなく、送った（published・failed・deleted の）配信先があり、
--   最後の更新から 1 日（failed が残っていれば 7 日）。下書きの投稿（配信先なし）の動画は消さない（量の上限で抑える）
-- 記録のない Storage のファイルは、両方のバケットで 1 日。あわせて 13 か月より前の月の本数を消す（費用の記録と同じ 13 か月）。
-- p_now: いまの時刻（結合テストが日数を確かめるため。毎日のジョブは渡さない）
drop function public.cleanup_media_candidates(integer, uuid);

create function public.cleanup_media_candidates(p_limit integer default 200, p_owner_id uuid default null, p_now timestamptz default now())
returns table (bucket text, storage_path text, media_id uuid, mark_removed boolean)
language sql
security definer
set search_path = ''
as $$
  with expired_tickets as (
    delete from public.media_upload_tickets t
     where t.created_at < p_now - interval '1 day'
       and (p_owner_id is null or t.owner_id = p_owner_id)
    returning t.storage_path
  ),
  -- 参照しなくても、data-modifying の CTE は 1 回実行される
  old_counts as (
    delete from public.video_upload_counts c
     where c.month < (date_trunc('month', p_now at time zone 'Asia/Tokyo') - interval '13 months')::date
       and (p_owner_id is null or c.owner_id = p_owner_id)
    returning 1
  )
  select 'post-media'::text, m.storage_path, m.id, false
    from public.media_files m
   where m.kind = 'image'
     and (p_owner_id is null or m.owner_id = p_owner_id)
     and (
       (m.post_id is null and m.note_id is null and m.source_of is null and m.created_at < p_now - interval '1 day')
       or (
         m.post_id is not null
         and not exists (
           select 1 from public.post_targets t where t.post_id = m.post_id and t.status in ('pending', 'preparing', 'publishing')
         )
         and exists (select 1 from public.post_targets t where t.post_id = m.post_id and t.status = 'published')
         and (select max(t.updated_at) from public.post_targets t where t.post_id = m.post_id) < p_now - interval '30 days'
       )
     )
  union all
  select 'post-videos'::text, m.storage_path, m.id, m.post_id is not null
    from public.media_files m
   where m.kind = 'video'
     and (p_owner_id is null or m.owner_id = p_owner_id)
     and (
       -- 添えていない（投稿を消したものを含む。ファイルを消したあとの行も、ここで行ごと消える）
       (m.post_id is null and m.created_at < p_now - interval '1 day')
       or (
         m.post_id is not null
         and m.removed_at is null
         and not exists (
           select 1 from public.post_targets t where t.post_id = m.post_id and t.status in ('pending', 'preparing', 'publishing')
         )
         and exists (select 1 from public.post_targets t where t.post_id = m.post_id and t.status in ('published', 'failed', 'deleted'))
         and (select max(t.updated_at) from public.post_targets t where t.post_id = m.post_id) < p_now - case
           when exists (select 1 from public.post_targets t where t.post_id = m.post_id and t.status = 'failed') then interval '7 days'
           else interval '1 day'
         end
       )
     )
  union all
  select o.bucket_id, o.name, null::uuid, false
    from storage.objects o
   where o.bucket_id in ('post-media', 'post-videos')
     and (p_owner_id is null or (storage.foldername(o.name))[1] = p_owner_id::text)
     and o.created_at < p_now - interval '1 day'
     and not exists (select 1 from public.media_files m where m.storage_path = o.name)
     and (
       not exists (select 1 from public.media_upload_tickets k where k.storage_path = o.name)
       or o.name in (select e.storage_path from expired_tickets e)
     )
  limit p_limit;
$$;

revoke all on function public.cleanup_media_candidates(integer, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.cleanup_media_candidates(integer, uuid, timestamptz) to service_role;
