-- Google Play の取り込みと、App Store のストアのページの閲覧数（F07 の段取り ⑤）。方針は docs/architecture.md の 4.22
-- Google Play: 利用者ごとに矢書の Google Cloud のプロジェクトの中にサービスアカウントを作り、利用者がそれを自分の Play Console に
-- 招待する。矢書は鍵を預からず、管理用のサービスアカウントがなりかわって、毎回 10 分だけの読み取りのトークンを作る。
-- App Store: Analytics Reports の依頼（ONGOING）は Admin のキーでしか作れないので、Admin のキーは保存せず 1 回だけ使って依頼を作り、
-- 依頼の ID だけを残す。読むのは保存してある Sales and Reports のキー。
-- どちらの表もサーバー（service_role）だけが扱う

-- ===== 取り込み元を足す =====
alter table public.store_daily drop constraint store_daily_source_check;
alter table public.store_daily
  add constraint store_daily_source_check check (source in ('app_store', 'revenuecat', 'google_play', 'app_store_views'));

-- ===== Google Play のつなぎ（プロジェクトに 1 つ） =====
create table public.play_connections (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 矢書が作った、この利用者・プロジェクト専用のサービスアカウント（利用者が Play Console に招待する）
  service_account_email text not null unique check (service_account_email ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z0-9-]+\.iam\.gserviceaccount\.com$'),
  -- Play Console の一括レポートの置き場所（pubsite_prod_rev_ で始まる）とアプリのパッケージ名。確かめるまでは空
  bucket text check (bucket is null or bucket ~ '^pubsite_prod_[a-z0-9_]{3,60}$'),
  package_name text check (package_name is null or package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'),
  -- pending: 招待と入力を待っている / ok: 読めた / error: 読めなかった（理由は last_error）
  status text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index play_connections_owner_idx on public.play_connections (owner_id);

create trigger play_connections_set_updated_at
  before update on public.play_connections
  for each row execute function public.set_updated_at();

alter table public.play_connections enable row level security;
revoke all on public.play_connections from anon, authenticated;

-- ===== App Store の Analytics Reports の依頼（プロジェクトに 1 つ） =====
create table public.app_store_report_requests (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9-]{1,100}$'),
  app_apple_id text not null check (app_apple_id ~ '^[0-9]{5,20}$'),
  status text not null default 'ok' check (status in ('ok', 'error')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  last_imported_day date,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index app_store_report_requests_owner_idx on public.app_store_report_requests (owner_id);

create trigger app_store_report_requests_set_updated_at
  before update on public.app_store_report_requests
  for each row execute function public.set_updated_at();

alter table public.app_store_report_requests enable row level security;
revoke all on public.app_store_report_requests from anon, authenticated;

-- ===== 週ごとの合計に、Google Play とストアのページの閲覧を足す =====
-- ダウンロード: App Store の初回のダウンロード + Google Play のインストール（Daily User Installs）
-- ストアのページの閲覧: App Store のページの閲覧（Product Page Views）+ Google Play のストアの掲載情報の訪問者
drop function public.store_weekly_totals(uuid, date);

create function public.store_weekly_totals(p_project_id uuid, p_today date)
returns table (
  downloads_this_week bigint,
  downloads_last_week bigint,
  revenue_latest numeric,
  revenue_week_ago numeric,
  revenue_currency text,
  page_views_this_week bigint,
  page_views_last_week bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select coalesce(sum((d."values" ->> 'downloads')::bigint), 0) from public.store_daily d
      where d.project_id = p_project_id and d.source in ('app_store', 'google_play') and d.day > p_today - 7),
    (select coalesce(sum((d."values" ->> 'downloads')::bigint), 0) from public.store_daily d
      where d.project_id = p_project_id and d.source in ('app_store', 'google_play') and d.day > p_today - 14 and d.day <= p_today - 7),
    (select (d."values" ->> 'revenue')::numeric from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' order by d.day desc limit 1),
    (select (d."values" ->> 'revenue')::numeric from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' and d.day <= p_today - 7 order by d.day desc limit 1),
    (select d."values" ->> 'currency' from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' order by d.day desc limit 1),
    (select coalesce(sum((d."values" ->> 'page_views')::bigint), 0) from public.store_daily d
      where d.project_id = p_project_id and d.source in ('app_store_views', 'google_play') and d.day > p_today - 7),
    (select coalesce(sum((d."values" ->> 'page_views')::bigint), 0) from public.store_daily d
      where d.project_id = p_project_id and d.source in ('app_store_views', 'google_play') and d.day > p_today - 14 and d.day <= p_today - 7);
$$;

revoke execute on function public.store_weekly_totals(uuid, date) from public, anon, authenticated;
grant execute on function public.store_weekly_totals(uuid, date) to authenticated;
