-- Apple が数えた、矢書の短縮リンク（キャンペーンリンクの ct）ごとのはじめてのダウンロード（数字の段 5。docs/architecture.md の 4.22）。
-- Analytics Reports の App Store Downloads の Detailed（Campaign の列があるのは Detailed だけ）から、日ごとに
-- { by_source: { <SNS>: n }, by_campaign: { <リンクのコード>: n } } を入れる。形が違って読めなかった回は { unreadable: true }。
-- ページの閲覧（app_store_views）の行とは分ける（あちらは取り込みのたびに上書きするため）。RLS と grant は store_daily のまま（本人だけ読める・書くのはサーバーだけ）
alter table public.store_daily drop constraint store_daily_source_check;
alter table public.store_daily
  add constraint store_daily_source_check check (source in ('app_store', 'revenuecat', 'google_play', 'app_store_views', 'app_store_campaigns'));
