-- 送り終えた動画は、すぐに消す（2026-11-15 オーナーの了承。docs/design/video.md の 7.、docs/architecture.md の 4.73）
-- 送信ジョブ（と「手で投稿した」の記録）が、投稿のすべての配信先が終わった時点で removed_at を入れてファイルを消す（src/lib/media/video-store.ts の removeSentVideo）。
-- 毎日の片付け（cleanup_media_candidates）は取りこぼしの受け皿として残し、次の 2 つを変える。
-- 1. 送り終えた動画（failed が残っていない）の待ちを、1 日から 0 にする。failed（「手で投稿する」の印を含む）が残れば、今のまま最後の更新から 7 日
-- 2. removed_at を入れたのにファイルが残っている動画（送信ジョブがファイルを消しそこねた）も、ファイルを消す候補にする（mark_removed は true。removed_at は上書きしない: src/lib/media/store.ts の cleanupMedia）
-- ほかは 20261115100000_post_videos のまま

create or replace function public.cleanup_media_candidates(p_limit integer default 200, p_owner_id uuid default null, p_now timestamptz default now())
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
         -- 送り終えた（failed がない）ものは待たない。failed が残れば、最後の更新から 7 日
         and (
           not exists (select 1 from public.post_targets t where t.post_id = m.post_id and t.status = 'failed')
           or (select max(t.updated_at) from public.post_targets t where t.post_id = m.post_id) < p_now - interval '7 days'
         )
       )
       -- 送信ジョブが removed_at を入れたが、ファイルを消しそこねた
       or (
         m.post_id is not null
         and m.removed_at is not null
         and exists (select 1 from storage.objects o where o.bucket_id = 'post-videos' and o.name = m.storage_path)
       )
     )
  union all
  select o.bucket_id, o.name, null::uuid, false
    from storage.objects o
   where o.bucket_id in ('post-media', 'post-videos')
     and (p_owner_id is null or (storage.foldername(o.name))[1] = p_owner_id::text)
     and not exists (select 1 from public.media_files m where m.storage_path = o.name)
     and (
       -- 確かめに使った（断った・外した）動画の引換券の場所に、上げ直されたファイル: 1 日を待たずに消す
       exists (select 1 from public.media_upload_tickets k where k.storage_path = o.name and k.consumed_at is not null)
       or (
         o.created_at < p_now - interval '1 day'
         and (
           not exists (select 1 from public.media_upload_tickets k where k.storage_path = o.name)
           or o.name in (select e.storage_path from expired_tickets e)
         )
       )
     )
  limit p_limit;
$$;

revoke all on function public.cleanup_media_candidates(integer, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.cleanup_media_candidates(integer, uuid, timestamptz) to service_role;
