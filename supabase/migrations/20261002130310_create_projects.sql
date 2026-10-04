-- プロジェクト = 宣伝したいアプリ 1 つ（要求 F02）
-- SNS アカウントとの紐づけ（アプリごとに分ける / 統一する）はフェーズ 1 で
-- social_accounts と project_social_accounts を追加して表現する。

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 2000),
  target_audience text not null default '' check (char_length(target_audience) <= 1000),
  app_store_url text check (app_store_url is null or app_store_url ~ '^https://'),
  play_store_url text check (play_store_url is null or play_store_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.projects is '宣伝対象のアプリ';
comment on column public.projects.target_audience is '届けたい相手（ペルソナ）。AI のネタ出しや壁打ちの文脈に使う';

create index projects_owner_id_idx on public.projects (owner_id, created_at desc);

-- updated_at を自動更新する共通関数
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- 行単位のアクセス制御: 自分のプロジェクトだけを読み書きできる
alter table public.projects enable row level security;

create policy "projects_select_own" on public.projects
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy "projects_insert_own" on public.projects
  for insert to authenticated with check ((select auth.uid()) = owner_id);

create policy "projects_update_own" on public.projects
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "projects_delete_own" on public.projects
  for delete to authenticated using ((select auth.uid()) = owner_id);
