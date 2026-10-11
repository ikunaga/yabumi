-- 画像の添付（20261011240000・240100）の続き。docs/architecture.md の 4.18
-- ① 権限: 240000 を 20261011220100_explicit_grants より前に当てた環境（開発中のローカル）では、media_files に
--    Supabase の既定の全権限（anon を含む）が付いたままになる。どの環境でも同じ権限になるよう、ここで付け直す（何度当てても同じ）
revoke all on public.media_files from anon, authenticated;
grant select on public.media_files to authenticated;
revoke all on public.media_upload_tickets from anon, authenticated;

-- ② 片付けの候補を、利用者で絞れるようにする（結合テストが、ローカル DB のほかの人の画像まで消さないため）。
--    毎日のジョブは絞らずに呼ぶ（p_owner_id が null）
drop function public.cleanup_media_candidates(integer);

create function public.cleanup_media_candidates(p_limit integer default 200, p_owner_id uuid default null)
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
       (m.post_id is null and m.created_at < now() - interval '1 day')
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

revoke execute on function public.cleanup_media_candidates(integer, uuid) from public, anon, authenticated;
grant execute on function public.cleanup_media_candidates(integer, uuid) to service_role;
