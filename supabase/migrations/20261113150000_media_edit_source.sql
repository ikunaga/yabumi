-- 添えた画像の「整えた元」を DB に持つ（docs/architecture.md の 4.68。2026-11-13 オーナーの了承、案 B）。
-- 見出しを付けた・縦横を整えた・調整した画像を、下書きを保存して開き直しても「見出しを直す」「元に戻す」ができるようにする。
-- - 添えた画像（整えたもの）の行に、元の画像（original_id）・最後に描き直した元（edit_base_id）・整え方（edit。種類と見出しの設定・調整の値）・
--   画像に文字が入っているか（has_text）を持つ。どれもサーバー（投稿の保存）だけが書く。利用者は select だけ（RLS で本人の行）
-- - 元の画像の行は、投稿に添えない（post_id は null のまま。送る画像にも、投稿の画像の一覧にも入らない）。source_of に、その元を使っている
--   添えた画像を指し、その画像が消えたら一緒に消える（on delete cascade。ファイルは、行のないファイルとして翌日の片付けで消える）
-- - source_of のある元の画像は、「添えないまま 1 日」の片付けで消さず、「保存していない画像」の数（20 枚）にも数えない

alter table public.media_files
  add column original_id uuid references public.media_files (id) on delete set null,
  add column edit_base_id uuid references public.media_files (id) on delete set null,
  add column edit jsonb,
  add column has_text boolean,
  add column source_of uuid references public.media_files (id) on delete cascade;

create index media_files_source_of_idx on public.media_files (source_of) where source_of is not null;

-- 元の画像は投稿にもメモにも添えない
alter table public.media_files add constraint media_files_source_unattached check (source_of is null or (post_id is null and note_id is null));
-- 整え方は、種類と、見出しの設定・調整の値だけ（中身はサーバーが確かめて書く）
alter table public.media_files add constraint media_files_edit_shape check (edit is null or (jsonb_typeof(edit) = 'object' and edit->>'kind' in ('aspect', 'adjust', 'headline')));

-- 権限: 利用者は読むだけ（いまの grant select のまま。書くのはサーバーの権限）。新しい列も select の対象（RLS で本人の行だけ）
revoke insert, update, delete on public.media_files from anon, authenticated;

-- 片付け: 「添えないまま 1 日」から、元の画像（source_of のある行）を外す（それ以外は 20261012040000 と同じ）
create or replace function public.cleanup_media_candidates(p_limit integer default 200, p_owner_id uuid default null)
returns table (storage_path text, media_id uuid)
language sql
security definer
set search_path = ''
as $$
  with expired_tickets as (
    delete from public.media_upload_tickets t
     where t.created_at < now() - interval '1 day'
       and (p_owner_id is null or t.owner_id = p_owner_id)
    returning t.storage_path
  )
  select m.storage_path, m.id
    from public.media_files m
   where (p_owner_id is null or m.owner_id = p_owner_id)
     and (
       (m.post_id is null and m.note_id is null and m.source_of is null and m.created_at < now() - interval '1 day')
       or (
         m.post_id is not null
         and not exists (
           select 1 from public.post_targets t where t.post_id = m.post_id and t.status in ('pending', 'publishing')
         )
         and exists (select 1 from public.post_targets t where t.post_id = m.post_id and t.status = 'published')
         and (select max(t.updated_at) from public.post_targets t where t.post_id = m.post_id) < now() - interval '30 days'
       )
     )
  union all
  select o.name, null::uuid
    from storage.objects o
   where o.bucket_id = 'post-media'
     and (p_owner_id is null or (storage.foldername(o.name))[1] = p_owner_id::text)
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.media_files m where m.storage_path = o.name)
     and (
       not exists (select 1 from public.media_upload_tickets k where k.storage_path = o.name)
       or o.name in (select e.storage_path from expired_tickets e)
     )
  limit p_limit;
$$;

revoke execute on function public.cleanup_media_candidates(integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.cleanup_media_candidates(integer, uuid) to service_role;

-- アップロード URL の発行: 「添えていない画像」の数に、元の画像（source_of のある行）を数えない（それ以外は 20261012040000 と同じ）
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
   where owner_id = p_owner_id and created_at > now() - interval '1 day';
  if v_pending >= p_max_pending then
    return 'too_many_pending';
  end if;

  select count(*) into v_unattached from public.media_files where owner_id = p_owner_id and post_id is null and note_id is null and source_of is null;
  if v_unattached + v_pending >= p_max_unattached then
    return 'too_many_unattached';
  end if;

  select coalesce(sum(size_bytes), 0) into v_used from public.media_files where owner_id = p_owner_id;
  if v_used + (v_pending + 1) * p_max_file_bytes > p_quota_bytes then
    return 'quota';
  end if;

  insert into public.media_upload_tickets (owner_id, storage_path) values (p_owner_id, p_storage_path);
  return 'ok';
end;
$$;

revoke execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) to service_role;
