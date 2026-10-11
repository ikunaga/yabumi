-- 投稿に画像を添付する（F03・F14 の一部）。方針は docs/architecture.md の 4.17
-- 画像は Supabase Storage の非公開のバケット post-media の「<利用者の ID>/<乱数>.jpg」に、ブラウザから直接上げる（Vercel の関数を通さない）。
-- 上げた画像は、サーバーが中身を確かめ（JPEG か、大きさ）、位置情報などのメタデータを消して置き直してから、media_files に記録する。
-- media_files の書き込みはサーバー（secret キー）だけ。利用者は自分のものを読めるだけ。記録のない画像は投稿に使えない。

-- ===== バケット =====
-- 送る前にブラウザで JPEG に縮めるので、1 枚 4MB まで（Facebook の写真の上限。X は 5MB、Threads・Instagram は 8MB）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 4194304, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 自分のフォルダにだけ上げられ、自分のフォルダだけ読める（画面のプレビュー用の署名 URL を作るため）。
-- 上書き・削除は利用者にはさせない（確かめたあとの画像を差し替えられないように）。削除はサーバーが行う
create policy "post_media_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "post_media_select_own_folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ===== 確かめた画像 =====
create table public.media_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 添付した投稿。投稿を消すと空になり、毎日の片付け（cleanup_media_candidates）で画像ごと消える
  post_id uuid references public.posts (id) on delete set null,
  storage_path text not null unique,
  -- 投稿の中の並び順（0 から）
  position smallint not null default 0,
  -- 代わりの文（alt）。画面の読み上げと、X・Threads の代わりの文に使う
  alt_text text not null default '' check (char_length(alt_text) <= 1000),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path like owner_id::text || '/%')
);

create index media_files_post_idx on public.media_files (post_id, position);
create index media_files_owner_idx on public.media_files (owner_id);

create trigger media_files_set_updated_at
  before update on public.media_files
  for each row execute function public.set_updated_at();

alter table public.media_files enable row level security;
create policy "media_files_select_own" on public.media_files
  for select to authenticated using ((select auth.uid()) = owner_id);

-- ===== 毎日の片付け =====
-- 消してよい画像の一覧（サーバーが Storage の API で消し、行も消す）。
-- ① 投稿に添付しないまま 1 日たったもの ② 添付した投稿が消えたもの ③ 送り終えて 30 日たったもの
--   （投稿のどの配信先も送信待ち・送信中でなく、1 つ以上が送信済みで、最後の更新から 30 日）
-- ④ 記録のない Storage のファイル（確かめる前に止まった、退会した人の、など）で 1 日たったもの
create function public.cleanup_media_candidates(p_limit integer default 200)
returns table (storage_path text, media_id uuid)
language sql
security definer
set search_path = ''
as $$
  select m.storage_path, m.id
    from public.media_files m
   where (m.post_id is null and m.created_at < now() - interval '1 day')
      or (
        m.post_id is not null
        and not exists (
          select 1 from public.post_targets t where t.post_id = m.post_id and t.status in ('pending', 'publishing')
        )
        and exists (select 1 from public.post_targets t where t.post_id = m.post_id and t.status = 'published')
        and (select max(t.updated_at) from public.post_targets t where t.post_id = m.post_id) < now() - interval '30 days'
      )
  union all
  select o.name, null::uuid
    from storage.objects o
   where o.bucket_id = 'post-media'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.media_files m where m.storage_path = o.name)
  limit p_limit;
$$;

revoke execute on function public.cleanup_media_candidates(integer) from public, anon, authenticated;
grant execute on function public.cleanup_media_candidates(integer) to service_role;

-- 利用者ごとの使っている容量（バイト）。上げる前の上限の確認に使う
create function public.media_usage_bytes(p_owner_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(size_bytes), 0)::bigint from public.media_files where owner_id = p_owner_id;
$$;

revoke execute on function public.media_usage_bytes(uuid) from public, anon, authenticated;
grant execute on function public.media_usage_bytes(uuid) to service_role;

-- 毎日 4:00（日本時間）: 画像の片付け
select cron.schedule('yabumi-cleanup-media', '0 19 * * *', $$select public.invoke_job('/api/jobs/cleanup-media')$$);
