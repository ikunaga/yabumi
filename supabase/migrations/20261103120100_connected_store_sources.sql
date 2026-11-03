-- いまつないでいるストアの取り込み元（PM の依頼）。遅れて届く数字の「届いた日」（すべてのストアから届いているいちばん新しい日）を、
-- いまつないでいるストアの中だけで決めるために使う。外したストアの最後の日に、期間の終わりが引っ張られないように。
-- つなぎの表（store_credentials・play_connections・app_store_report_requests）は鍵や依頼の ID を持ち、サーバーだけが扱う（利用者には権限がない）。
-- ここでは、本人のプロジェクトについて、つないでいる取り込み元の名前だけを返す（鍵・状態・日時は返さない）。
-- 本人かどうかは関数の中で確かめる（public.projects の持ち主が auth.uid() と同じ）。他人のプロジェクトと、ログインしていない（auth.uid() が null）ときは null
-- 「つないでいる」の決め方: つなぎの行があること（状態は見ない）。
--   - 鍵が無効になった（status = 'error'）・確かめる前（play_connections の 'pending'）も、つないでいるとみなす。利用者が外していないので、
--     届いた日はそのストアの最後の日のまま止まり、期間の終わりが止まって見える（「10/20 までの 7 日」。つなぎ直しの案内はストアの画面に出る）。
--     まだ 1 日も届いていない取り込み元は、届いた日を決めるときに数えない（src/lib/overview/numbers.ts の arrivedUntil）
--   - 外した・依頼を取り消したときは、つなぎの行を消す（src/lib/stores/store.ts・play-store.ts）ので、つないでいないことになる
--   app_store: App Store Connect の鍵（store_credentials の app_store_connect）
--   app_store_views: App Store の Analytics Reports の依頼（app_store_report_requests）
--   google_play: Google Play のつなぎ（play_connections）

create function public.connected_store_sources(p_project_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when exists (select 1 from public.store_credentials c where c.project_id = p.id and c.provider = 'app_store_connect') then 'app_store' end,
    case when exists (select 1 from public.app_store_report_requests r where r.project_id = p.id) then 'app_store_views' end,
    case when exists (select 1 from public.play_connections c where c.project_id = p.id) then 'google_play' end
  ], null)
    from public.projects p
   where p.id = p_project_id
     and p.owner_id = (select auth.uid());
$$;

revoke all on function public.connected_store_sources(uuid) from public, anon, authenticated, service_role;
grant execute on function public.connected_store_sources(uuid) to authenticated;
