-- アカウント設計（要求 F15、決定 D12）。誰に・何のために・どんな名前で・どんな投稿をするかを、プロジェクトごとに 1 つ持つ。
-- 中身はセクションごとの JSON（data.goal, data.audience, ...）。形はアプリ側（src/lib/plan/schema.ts）で検証する。
-- セクション単位で保存するので、AI 壁打ち（F09）がセクションごとに案を出して、利用者が採用する形にもそのまま使える。
-- 「届けたい相手」の本文は projects.target_audience を正とし、ここには持たない（二重管理を避ける）。

create table public.account_plans (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- data の形の版。形を変えるときに上げ、古い版を読み替える
  schema_version integer not null default 1,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  -- 「あとで設計する」を選んだ日時。設計を飛ばして次の段階へ進める
  skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.account_plans is 'SNS アカウントの設計（目的、届けたい相手、持ち方、名前とプロフィール、投稿の柱、頻度、最初の 1 か月）';

create trigger account_plans_set_updated_at
  before update on public.account_plans
  for each row execute function public.set_updated_at();

alter table public.account_plans enable row level security;

create policy "account_plans_select_own" on public.account_plans
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "account_plans_insert_own" on public.account_plans
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "account_plans_update_own" on public.account_plans
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "account_plans_delete_own" on public.account_plans
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 1 つのセクションを保存する。他のセクションは消さずに残す（別のタブで別のセクションを保存しても上書きし合わない）。
-- security invoker なので RLS がそのまま効く。audience の who は projects.target_audience に書く。
create function public.save_account_plan_section(p_project_id uuid, p_section text, p_value jsonb)
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

  if p_section = 'audience' then
    update public.projects set target_audience = coalesce(p_value->>'who', '') where id = p_project_id;
    if not found then
      raise exception 'project not found' using errcode = 'P0002';
    end if;
    v_value := p_value - 'who';
  end if;

  insert into public.account_plans (project_id, data)
  values (p_project_id, jsonb_build_object(p_section, v_value))
  on conflict (project_id) do update
    set data = public.account_plans.data || jsonb_build_object(p_section, v_value);
end;
$$;

revoke execute on function public.save_account_plan_section(uuid, text, jsonb) from public, anon;
grant execute on function public.save_account_plan_section(uuid, text, jsonb) to authenticated;
