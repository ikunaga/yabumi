-- ストアと課金の取り込み（F07 の段取り ③。App Store Connect の Sales and Trends と RevenueCat）。方針は docs/architecture.md の 4.22
-- 利用者から預かる鍵は store_credentials に、アプリの側で暗号化して入れる（CREDENTIAL_ENCRYPTION_KEY。SNS のトークンとは別の鍵）。
-- store_credentials はサーバー（service_role）だけが扱い、利用者には権限を与えない（状態はサーバーが確かめてから画面に出す）。
-- 取り込んだ日ごとの数字は store_daily に置き、利用者は自分のものを読めるだけ

-- ===== 預かる鍵（プロジェクト × 取り込み元で 1 つ） =====
create table public.store_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  provider text not null check (provider in ('app_store_connect', 'revenuecat')),
  -- 鍵そのもの（JSON を暗号化したもの。c1.<鍵の印>.<iv>.<tag>.<暗号文>）
  secret_sealed text not null,
  -- 画面に出す見分けの印（例: Key ID の末尾 4 文字）。秘密は入れない
  hint text not null default '' check (char_length(hint) <= 100),
  -- ok: 最後に使えた / error: 最後に失敗した（理由は last_error）
  status text not null default 'ok' check (status in ('ok', 'error')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  last_checked_at timestamptz,
  -- ここまで取り込んだ日（取り込み元の日付。App Store は太平洋時間の日）
  last_imported_day date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider)
);

create index store_credentials_owner_idx on public.store_credentials (owner_id);

create trigger store_credentials_set_updated_at
  before update on public.store_credentials
  for each row execute function public.set_updated_at();

-- ポリシーも権限も置かない。画面側（anon・authenticated）からは読めず、書けない
alter table public.store_credentials enable row level security;
revoke all on public.store_credentials from anon, authenticated;

-- ===== 取り込んだ日ごとの数字 =====
-- values の中身: app_store は {"downloads", "redownloads", "updates", "iap_units", "proceeds": {"USD": 1.2, ...}}、
-- revenuecat は概要の数字（{"mrr", "revenue", "active_subscriptions", "active_trials", "new_customers"}。revenue は直近 28 日の合計）
create table public.store_daily (
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('app_store', 'revenuecat')),
  day date not null,
  "values" jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (project_id, source, day)
);

create index store_daily_owner_idx on public.store_daily (owner_id, day);

create trigger store_daily_set_updated_at
  before update on public.store_daily
  for each row execute function public.set_updated_at();

alter table public.store_daily enable row level security;
create policy "store_daily_select_own" on public.store_daily
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.store_daily from anon, authenticated;
grant select on public.store_daily to authenticated;

-- ===== 週ごとの合計（数字の画面の KPI。security invoker で本人のものだけ） =====
-- ダウンロード: App Store の初回のダウンロード（downloads）を、直近 7 日・その前の 7 日で合計（日は取り込み元の日付）
-- 課金: RevenueCat の直近 28 日の売上の、いちばん新しい値と、その 7 日前の値
create function public.store_weekly_totals(p_project_id uuid, p_today date)
returns table (downloads_this_week bigint, downloads_last_week bigint, revenue_latest numeric, revenue_week_ago numeric, revenue_currency text)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select coalesce(sum((d."values" ->> 'downloads')::bigint), 0) from public.store_daily d
      where d.project_id = p_project_id and d.source = 'app_store' and d.day > p_today - 7),
    (select coalesce(sum((d."values" ->> 'downloads')::bigint), 0) from public.store_daily d
      where d.project_id = p_project_id and d.source = 'app_store' and d.day > p_today - 14 and d.day <= p_today - 7),
    (select (d."values" ->> 'revenue')::numeric from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' order by d.day desc limit 1),
    (select (d."values" ->> 'revenue')::numeric from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' and d.day <= p_today - 7 order by d.day desc limit 1),
    (select d."values" ->> 'currency' from public.store_daily d
      where d.project_id = p_project_id and d.source = 'revenuecat' order by d.day desc limit 1);
$$;

revoke execute on function public.store_weekly_totals(uuid, date) from public, anon, authenticated;
grant execute on function public.store_weekly_totals(uuid, date) to authenticated;

-- 毎日 3:00（日本時間）から 10 分おきに 3 回: 取り込み（1 回に処理する数を絞り、残りは次の回）
select cron.schedule('yabumi-import-stores', '0,10,20 18 * * *', $$select public.invoke_job('/api/jobs/import-stores')$$);
