-- フェーズ 1: SNS アカウント、投稿、SNS ごとの配信先（要求 F02, F03, F05, F06）

-- 対象の SNS（要求 D1）
create domain public.sns_key as text
  check (value in ('x', 'instagram', 'facebook', 'threads', 'tiktok', 'youtube'));

-- ===== SNS アカウント =====
-- アカウントはユーザーに属し、プロジェクトとは多対多でつなぐ。
-- 「アプリごとに分ける」と「全アプリで 1 つを使う」を同じ仕組みで表す。
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sns public.sns_key not null,
  external_id text not null,
  display_name text not null default '',
  handle text not null default '',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, sns, external_id)
);

comment on table public.social_accounts is '連携した SNS アカウント。トークンは social_account_tokens に分けて置く';

create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

alter table public.social_accounts enable row level security;

create policy "social_accounts_select_own" on public.social_accounts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "social_accounts_update_own" on public.social_accounts
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "social_accounts_delete_own" on public.social_accounts
  for delete to authenticated using ((select auth.uid()) = owner_id);
-- 追加は OAuth の受け口（サーバー）だけが行うので、利用者向けの insert ポリシーは置かない

-- アクセストークン。ポリシーを置かないので、画面側（authenticated）からは読み書きできない。
-- サーバーが secret キーで扱い、値はアプリ側で暗号化してから入れる。
create table public.social_account_tokens (
  social_account_id uuid primary key references public.social_accounts (id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.social_account_tokens is 'SNS のトークン（暗号化済み）。サーバーのみが扱う';

alter table public.social_account_tokens enable row level security;

create trigger social_account_tokens_set_updated_at
  before update on public.social_account_tokens
  for each row execute function public.set_updated_at();

-- ===== プロジェクトと SNS アカウントの紐づけ =====
create table public.project_social_accounts (
  project_id uuid not null references public.projects (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, social_account_id)
);

create index project_social_accounts_account_idx on public.project_social_accounts (social_account_id);

alter table public.project_social_accounts enable row level security;

create policy "project_social_accounts_select_own" on public.project_social_accounts
  for select to authenticated using ((select auth.uid()) = owner_id);
-- 自分のプロジェクトと自分のアカウントの組み合わせだけを作れる
create policy "project_social_accounts_insert_own" on public.project_social_accounts
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
    and exists (select 1 from public.social_accounts a where a.id = social_account_id and a.owner_id = (select auth.uid()))
  );
create policy "project_social_accounts_delete_own" on public.project_social_accounts
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ===== 投稿 =====
-- 1 つの下書きに、SNS ごとの配信先（post_targets）がぶら下がる
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 10000),
  -- 送る予定の日時。下書きでも入れられ、カレンダーに予定として出る
  planned_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_scheduled_needs_time check (status <> 'scheduled' or planned_at is not null)
);

create index posts_project_planned_idx on public.posts (project_id, planned_at);

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

create policy "posts_select_own" on public.posts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "posts_insert_own" on public.posts
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "posts_update_own" on public.posts
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "posts_delete_own" on public.posts
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ===== SNS ごとの配信先 =====
create table public.post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sns public.sns_key not null,
  -- 送り先のアカウント。SNS をつなぐ前の下書きでは空
  social_account_id uuid references public.social_accounts (id) on delete set null,
  -- その SNS 用に変えた文面。空なら下書きの本文を使う
  body_override text check (body_override is null or char_length(body_override) <= 10000),
  status text not null default 'pending' check (status in ('pending', 'publishing', 'published', 'failed')),
  external_post_id text,
  published_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, sns)
);

create trigger post_targets_set_updated_at
  before update on public.post_targets
  for each row execute function public.set_updated_at();

alter table public.post_targets enable row level security;

create policy "post_targets_select_own" on public.post_targets
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "post_targets_insert_own" on public.post_targets
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.posts p where p.id = post_id and p.owner_id = (select auth.uid()))
    and (
      social_account_id is null
      or exists (select 1 from public.social_accounts a where a.id = social_account_id and a.owner_id = (select auth.uid()))
    )
  );
create policy "post_targets_update_own" on public.post_targets
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and (
      social_account_id is null
      or exists (select 1 from public.social_accounts a where a.id = social_account_id and a.owner_id = (select auth.uid()))
    )
  );
create policy "post_targets_delete_own" on public.post_targets
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ===== 投稿と配信先をまとめて保存する =====
-- security invoker なので、上の RLS がそのまま効く。途中で失敗したら全部取り消される。
-- p_targets: [{"sns": "x", "body_override": null, "social_account_id": null}, ...]
create function public.save_post(
  p_post_id uuid,
  p_project_id uuid,
  p_body text,
  p_planned_at timestamptz,
  p_status text,
  p_targets jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post_id uuid;
begin
  if p_post_id is null then
    insert into public.posts (project_id, body, planned_at, status)
    values (p_project_id, p_body, p_planned_at, p_status)
    returning id into v_post_id;
  else
    update public.posts
      set body = p_body, planned_at = p_planned_at, status = p_status
      where id = p_post_id and project_id = p_project_id
      returning id into v_post_id;
    if v_post_id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
  end if;

  -- 外された SNS の配信先を消す（送信済みのものは残す）
  delete from public.post_targets t
    where t.post_id = v_post_id
      and t.status = 'pending'
      and t.sns not in (select x->>'sns' from jsonb_array_elements(p_targets) as x);

  insert into public.post_targets (post_id, sns, body_override, social_account_id)
  select v_post_id,
         x->>'sns',
         nullif(x->>'body_override', ''),
         nullif(x->>'social_account_id', '')::uuid
    from jsonb_array_elements(p_targets) as x
  on conflict (post_id, sns) do update
    set body_override = excluded.body_override,
        social_account_id = excluded.social_account_id
    where public.post_targets.status = 'pending';

  return v_post_id;
end;
$$;
