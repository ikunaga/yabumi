-- ネタ帳（F17）。生活の中で思いついた投稿のネタや経験を、さっとメモに残し、あとで投稿の材料にする（docs/architecture.md の 4.26）。
-- メモは利用者が消すか、プロジェクトを消すか、退会するまで残る。メモに添えた画像（1 枚まで）は 4.18 の画像の置き場所に置き、
-- メモが残っている間は消さない（media_files.note_id）。メモを消すと、画像は投稿に添えていない画像と同じく、翌日の片付けで消える

-- ===== メモ =====
create table public.idea_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 本文。写真だけのメモもあるので空でもよい（本文か画像のどちらかがあることは、サーバーで確かめる）
  body text not null default '' check (char_length(body) <= 2000),
  -- 投稿にした日時。下書きにしたら付く（下書きを消しても残る。「投稿にした」の印）
  used_at timestamptz,
  -- 最後に作った投稿（下書き）。投稿を消すと空になる
  post_id uuid references public.posts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.idea_notes is 'ネタ帳のメモ（F17。4.26）';

create index idea_notes_project_idx on public.idea_notes (project_id, created_at desc);
create index idea_notes_post_idx on public.idea_notes (post_id) where post_id is not null;

create trigger idea_notes_set_updated_at
  before update on public.idea_notes
  for each row execute function public.set_updated_at();

alter table public.idea_notes enable row level security;

create policy "idea_notes_select_own" on public.idea_notes
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "idea_notes_insert_own" on public.idea_notes
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
    and post_id is null
  );
-- 結びつける投稿は、本人の・同じプロジェクトの投稿だけ
create policy "idea_notes_update_own" on public.idea_notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and (post_id is null or exists (
      select 1 from public.posts p where p.id = post_id and p.owner_id = (select auth.uid()) and p.project_id = idea_notes.project_id
    ))
  );
create policy "idea_notes_delete_own" on public.idea_notes
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 権限はポリシーと同じ操作だけ（20261011220100_explicit_grants の決まり）。プロジェクトと持ち主は変えられない
revoke all on public.idea_notes from anon, authenticated;
grant select, delete on public.idea_notes to authenticated;
grant insert (project_id, body) on public.idea_notes to authenticated;
grant update (body, used_at, post_id) on public.idea_notes to authenticated;

-- ===== メモの画像 =====
-- media_files の書き込みはサーバー（secret キー）だけ（4.18）。メモを消すと空になり、投稿にも添えていなければ翌日の片付けで消える
alter table public.media_files add column note_id uuid references public.idea_notes (id) on delete set null;
create unique index media_files_note_idx on public.media_files (note_id) where note_id is not null;
alter table public.media_files add constraint media_files_post_or_note check (post_id is null or note_id is null);

-- 片付け: 「添えないまま 1 日たった画像」から、メモに添えた画像を外す（それ以外は 20261011240200 と同じ）
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
       (m.post_id is null and m.note_id is null and m.created_at < now() - interval '1 day')
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

-- アップロード URL の発行: 「添えていない画像」の数に、メモに添えた画像を数えない（それ以外は 20261011240300 と同じ）
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

  select count(*) into v_unattached from public.media_files where owner_id = p_owner_id and post_id is null and note_id is null;
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

-- create or replace は権限を変えないが、念のため付け直す（何度当てても同じ）
revoke execute on function public.cleanup_media_candidates(integer, uuid) from public, anon, authenticated;
grant execute on function public.cleanup_media_candidates(integer, uuid) to service_role;
revoke execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) from public, anon, authenticated;
grant execute on function public.issue_media_upload_ticket(uuid, text, integer, integer, bigint, bigint) to service_role;
