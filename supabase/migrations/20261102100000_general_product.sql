-- 矢書を、宣伝したい商品・サービスがある人のための汎用の SNS 運用ツールに広げる（決定 D34、2026-11-02）。
-- ① プロジェクトに、宣伝するものの種類（src/lib/projects/product-types.ts の PRODUCT_TYPES）。前のプロジェクトはアプリのまま（既定 app）
-- ② 行き先の URL（サイト・予約・ネットのお店・ストア・フォームなど。プロジェクトに複数。短縮リンクの行き先の候補）。
--    app_store_url・play_store_url はアプリのときの行き先として projects に残す（ストアの取り込みが使うため）
-- ③ 手で入れる成果（買った・申し込んだ・予約・問い合わせ・来店の、日ごとの数）。アプリ以外は、ストアのように自動では読めないため
-- 「見た人にしてほしいこと」はアカウント設計（account_plans の goal.goalType）を広げて持つので、ここでは足さない

-- ===== ① 宣伝するものの種類 =====
alter table public.projects
  add column product_type text not null default 'app'
    check (product_type in ('app', 'web_service', 'shop', 'online_shop', 'service', 'creator', 'other'));

comment on table public.projects is '宣伝するもの（アプリ・お店・サービス・作品など。決定 D34）';
comment on column public.projects.product_type is '宣伝するものの種類。app のときだけ、ストア・RevenueCat・GitHub の機能を出す';

-- ===== ② 行き先の URL =====
create table public.project_destinations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('site', 'booking', 'shop', 'store', 'form', 'other')),
  label text not null default '' check (char_length(label) <= 60),
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  position integer not null default 0 check (position between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.project_destinations is '行き先の URL（短縮リンクの行き先の候補。プロジェクトに 20 まで）';

create index project_destinations_project_idx on public.project_destinations (project_id, position);
create index project_destinations_owner_idx on public.project_destinations (owner_id);

create trigger project_destinations_set_updated_at
  before update on public.project_destinations
  for each row execute function public.set_updated_at();

-- 1 つのプロジェクトに 20 まで（画面は 10 まで。悪用で表がふくらまないように）
create function public.project_destinations_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.project_destinations d where d.project_id = new.project_id) >= 20 then
    raise exception '行き先の URL は 1 つのプロジェクトに 20 までです' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.project_destinations_limit() from public, anon, authenticated;

create trigger project_destinations_limit
  before insert on public.project_destinations
  for each row execute function public.project_destinations_limit();

alter table public.project_destinations enable row level security;

create policy "project_destinations_select_own" on public.project_destinations
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "project_destinations_insert_own" on public.project_destinations
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "project_destinations_update_own" on public.project_destinations
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "project_destinations_delete_own" on public.project_destinations
  for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.project_destinations to authenticated;

-- ===== ③ 手で入れる成果（日ごと） =====
create table public.project_outcomes_daily (
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  action text not null check (action in ('purchase', 'signup', 'booking', 'inquiry', 'visit')),
  count integer not null check (count between 0 and 100000),
  updated_at timestamptz not null default now(),
  primary key (project_id, day, action)
);

comment on table public.project_outcomes_daily is '利用者が手で入れる、日ごとの成果の数（買った・申し込んだ・予約・問い合わせ・来店）。アプリのダウンロードはストアから読むので入れない';

create index project_outcomes_daily_owner_idx on public.project_outcomes_daily (owner_id);

create trigger project_outcomes_daily_set_updated_at
  before update on public.project_outcomes_daily
  for each row execute function public.set_updated_at();

alter table public.project_outcomes_daily enable row level security;

create policy "project_outcomes_daily_select_own" on public.project_outcomes_daily
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "project_outcomes_daily_insert_own" on public.project_outcomes_daily
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "project_outcomes_daily_update_own" on public.project_outcomes_daily
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "project_outcomes_daily_delete_own" on public.project_outcomes_daily
  for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.project_outcomes_daily to authenticated;
