-- 画像のアップロードを、サーバーが 1 枚ずつ発行する署名つきのアップロード URL だけにする（docs/architecture.md の 4.17）。
-- 20261011240000 では、利用者が自分のフォルダに直接上げられるポリシーを置いていたが、それだと上限の確認を通さずに
-- 何枚でも上げられ、翌日の片付けまでの間に Storage（Free は全体で 1GB）を埋められてしまう。
-- サーバーは、確かめ待ちの引換券（media_upload_tickets）の数を見てから URL を発行し、確かめるときに引換券があることを確かめる。
-- プレビューの署名 URL もサーバーが作る。
drop policy if exists "post_media_insert_own_folder" on storage.objects;
drop policy if exists "post_media_select_own_folder" on storage.objects;

-- 発行したアップロード URL の引換券。確かめたら消す。サーバー（secret キー）だけが読み書きする
create table public.media_upload_tickets (
  storage_path text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (storage_path like owner_id::text || '/%')
);

create index media_upload_tickets_owner_idx on public.media_upload_tickets (owner_id, created_at);

-- ポリシーを置かないので、画面側（anon・authenticated）からは読めず、書けない
alter table public.media_upload_tickets enable row level security;

-- 片付け: 1 日たった引換券を消す（その画像は、記録がないので cleanup_media_candidates の ④ で消える）
create or replace function public.cleanup_media_candidates(p_limit integer default 200)
returns table (storage_path text, media_id uuid)
language sql
security definer
set search_path = ''
as $$
  with expired_tickets as (
    delete from public.media_upload_tickets t where t.created_at < now() - interval '1 day' returning t.storage_path
  )
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
     and (
       not exists (select 1 from public.media_upload_tickets k where k.storage_path = o.name)
       or o.name in (select e.storage_path from expired_tickets e)
     )
  limit p_limit;
$$;
