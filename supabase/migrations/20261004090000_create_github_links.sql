-- GitHub のリポジトリをプロジェクトにつなぐ（要求 F16、決定 D14）。方針は docs/architecture.md の 4.10
-- 矢書は GitHub App として、利用者が選んだリポジトリだけを読む（Contents: Read と Metadata: Read）。
-- トークンは保存しない。インストールのトークンは読むたびに App の秘密鍵から発行する。
-- 書き込みはサーバー（secret キー）だけが行う。インストールが本人のものであることは、GitHub の利用者の認可で確かめてから入れる。

-- 利用者が使える GitHub App のインストール（GitHub の個人またはオーガニゼーションごとに 1 つ）
create table public.github_installations (
  owner_id uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  account_type text not null default 'User',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, installation_id)
);

create trigger github_installations_set_updated_at
  before update on public.github_installations
  for each row execute function public.set_updated_at();

alter table public.github_installations enable row level security;
create policy "github_installations_select_own" on public.github_installations
  for select to authenticated using ((select auth.uid()) = owner_id);

-- プロジェクトにつないだリポジトリ（1 プロジェクトに 1 つ）
create table public.project_github_repos (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null,
  repo_id bigint not null,
  full_name text not null,
  default_branch text not null default 'main',
  is_private boolean not null default false,
  -- 最後に読んで説明を下書きした日時（中身は保存しない）
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, installation_id) references public.github_installations (owner_id, installation_id) on delete cascade
);

create trigger project_github_repos_set_updated_at
  before update on public.project_github_repos
  for each row execute function public.set_updated_at();

alter table public.project_github_repos enable row level security;
create policy "project_github_repos_select_own" on public.project_github_repos
  for select to authenticated using ((select auth.uid()) = owner_id);
-- つなぎを外すのは本人ができる（GitHub 側のインストールはそのまま）
create policy "project_github_repos_delete_own" on public.project_github_repos
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 「GitHub をつなぐ（任意）」を飛ばした日時
alter table public.projects add column github_prompt_dismissed_at timestamptz;
