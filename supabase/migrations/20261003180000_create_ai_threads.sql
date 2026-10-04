-- AI 壁打ち（F09 の一部を前倒し。決定 D13）。まずはアカウント設計で使う。方針は docs/architecture.md の 4.9
-- 会話（ai_threads / ai_messages）と、費用の上限を守るための利用量（ai_usage）。
-- どれも書き込みはサーバー（secret キー）だけが行う。利用者が会話を偽造したり、利用量を消して上限をすり抜けたりできないようにする。

create table public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 何のための会話か。いまはアカウント設計だけ
  purpose text not null check (purpose in ('account_plan')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_threads_project_idx on public.ai_threads (project_id, purpose, updated_at desc);

create trigger ai_threads_set_updated_at
  before update on public.ai_threads
  for each row execute function public.set_updated_at();

alter table public.ai_threads enable row level security;
create policy "ai_threads_select_own" on public.ai_threads
  for select to authenticated using ((select auth.uid()) = owner_id);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ai_threads (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- user: {kind: "text"|"start"|"focus"|"adopt", text, ...} / assistant: AI の返事（質問・選択肢・案）。形は src/lib/ai/plan-coach-schema.ts
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 65536),
  created_at timestamptz not null default now()
);

create index ai_messages_thread_idx on public.ai_messages (thread_id, created_at);

alter table public.ai_messages enable row level security;
create policy "ai_messages_select_own" on public.ai_messages
  for select to authenticated using ((select auth.uid()) = owner_id);

-- AI の利用量。会話やプロジェクトを消しても残す（上限を数えるため）。利用者を消したときだけ消える
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid references public.ai_threads (id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- 料金表から計算した見積もり（米ドル）
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_owner_idx on public.ai_usage (owner_id, created_at);

alter table public.ai_usage enable row level security;
create policy "ai_usage_select_own" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = owner_id);

-- ===== 設計の各セクションが、AI の案から採用したものか、手で書いたものか =====
alter table public.account_plans add column section_sources jsonb not null default '{}'::jsonb
  check (jsonb_typeof(section_sources) = 'object');

comment on column public.account_plans.section_sources is 'セクションごとの出どころ。{"pillars": "ai"} のように、ai（AI の案を採用）か manual（手で保存）';

drop function public.save_account_plan_section(uuid, text, jsonb);

create function public.save_account_plan_section(p_project_id uuid, p_section text, p_value jsonb, p_source text default 'manual')
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value jsonb := p_value;
begin
  if p_section not in ('goal', 'audience', 'ownership', 'profile', 'pillars', 'cadence', 'first_month') then
    raise exception 'unknown section: %', p_section using errcode = '22023';
  end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'section value must be an object' using errcode = '22023';
  end if;
  if p_source not in ('manual', 'ai') then
    raise exception 'unknown source: %', p_source using errcode = '22023';
  end if;

  if p_section = 'audience' then
    update public.projects set target_audience = coalesce(p_value->>'who', '') where id = p_project_id;
    if not found then
      raise exception 'project not found' using errcode = 'P0002';
    end if;
    v_value := p_value - 'who';
  end if;

  insert into public.account_plans (project_id, data, section_sources)
  values (p_project_id, jsonb_build_object(p_section, v_value), jsonb_build_object(p_section, p_source))
  on conflict (project_id) do update
    set data = public.account_plans.data || jsonb_build_object(p_section, v_value),
        section_sources = public.account_plans.section_sources || jsonb_build_object(p_section, p_source);
end;
$$;

revoke execute on function public.save_account_plan_section(uuid, text, jsonb, text) from public, anon;
grant execute on function public.save_account_plan_section(uuid, text, jsonb, text) to authenticated;
