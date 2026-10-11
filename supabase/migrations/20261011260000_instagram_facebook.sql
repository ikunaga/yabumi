-- Instagram と Facebook ページの連携（docs/architecture.md の 4.21）。

-- ===== Facebook ページを、つないだ Facebook の利用者と結びつける =====
-- Facebook ページは、ページ 1 つ = social_accounts の 1 行（external_id はページの ID）。
-- 利用者が Facebook の側で矢書を外した・データの削除を求めたときの通知には、Facebook の利用者の ID（アプリごと）しか入っていない。
-- その人がつないだページをまとめて外せるよう、つないだ人の ID を持つ
alter table public.social_accounts add column parent_external_id text;

comment on column public.social_accounts.parent_external_id is 'Facebook ページのとき、そのページをつないだ Facebook の利用者の ID（アプリごとの ID）。ほかの SNS は空';

create index social_accounts_parent_idx on public.social_accounts (sns, parent_external_id) where parent_external_id is not null;

-- ===== Facebook ページを選ぶまでの一時の置き場 =====
-- Facebook から戻ったあと、管理しているページの一覧を出して、つなぐページを選んでもらう。
-- その間（15 分）だけ、ページの一覧と、暗号化したページのトークンを置く。選んだら social_accounts に移して消す
create table public.pending_page_choices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 画面に出すページの一覧 [{ "id": "...", "name": "..." }]
  pages jsonb not null check (jsonb_typeof(pages) = 'array' and pg_column_size(pages) <= 65536),
  -- ページの ID → ページのトークン の JSON を、アプリで暗号化したもの（追加認証データは行の ID）
  tokens_encrypted text not null,
  -- つないだ Facebook の利用者の ID（social_accounts.parent_external_id に入れる）
  parent_external_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

comment on table public.pending_page_choices is 'Facebook ページを選ぶまでの一時の置き場（15 分）。トークンの列は利用者に見せない';

create index pending_page_choices_owner_idx on public.pending_page_choices (owner_id, expires_at);

alter table public.pending_page_choices enable row level security;
create policy "pending_page_choices_select_own" on public.pending_page_choices
  for select to authenticated using ((select auth.uid()) = owner_id and expires_at > now());
-- 書き込み・削除はサーバー（secret キー）だけ

-- 権限（4.17）: 利用者には、トークン以外の列を読むことだけを与える
revoke all on table public.pending_page_choices from anon, authenticated;
grant select (id, owner_id, project_id, pages, created_at, expires_at) on public.pending_page_choices to authenticated;
grant all on table public.pending_page_choices to service_role;

-- ===== 期限を過ぎたページの選択も、毎日の削除で消す =====
-- 戻り値の形は変えない（20261011220000 と同じ）。ページの選択は 15 分で使えなくなり、ここで行ごと消える
create or replace function public.purge_expired_data()
returns table (ai_threads_deleted integer, ai_usage_deleted integer, sns_api_usage_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threads integer;
  v_ai_usage integer;
  v_sns_usage integer;
begin
  delete from public.ai_threads where updated_at < now() - interval '1 year';
  get diagnostics v_threads = row_count;
  delete from public.ai_usage where created_at < now() - interval '13 months';
  get diagnostics v_ai_usage = row_count;
  delete from public.sns_api_usage where created_at < now() - interval '13 months';
  get diagnostics v_sns_usage = row_count;
  delete from public.pending_page_choices where expires_at < now();
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;
