-- AI で画像をつくるときの「絵の説明のフォーマット」（オーナーの Notion の項目。docs/architecture.md の 4.25 の ②、2026-11-07）。
-- プロジェクトごとに名前と本文（絵の説明の文。{場面} の穴を置ける）を登録し、画像をつくる画面で選んで使い回す。1 つを「いつも使う」にできる。
-- 新しく預かる情報なので、プライバシーポリシーの ②（docs/legal.md の「絵の説明のフォーマット」）。了承まで本番に出さない

create table public.photo_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  body text not null check (char_length(btrim(body)) between 1 and 600),
  is_default boolean not null default false,
  position integer not null default 0 check (position between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.photo_prompt_templates is 'AI で画像をつくるときの絵の説明のフォーマット（プロジェクトに 20 まで。is_default は 1 つだけ）';

create index photo_prompt_templates_project_idx on public.photo_prompt_templates (project_id, position);
create index photo_prompt_templates_owner_idx on public.photo_prompt_templates (owner_id);
-- 「いつも使う」はプロジェクトに 1 つだけ
create unique index photo_prompt_templates_one_default on public.photo_prompt_templates (project_id) where is_default;

create trigger photo_prompt_templates_set_updated_at
  before update on public.photo_prompt_templates
  for each row execute function public.set_updated_at();

-- 1 つのプロジェクトに 20 まで。同時に足されても超えないよう、数える前にそのプロジェクトの行を押さえる（行き先の URL と同じ作り。20261102210000）。
-- security invoker なので、押さえられるのは本人が更新できる自分のプロジェクトだけ（他人のものは RLS の with check で断られる）
create function public.photo_prompt_templates_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.projects where id = new.project_id for update;
  if (select count(*) from public.photo_prompt_templates t where t.project_id = new.project_id) >= 20 then
    raise exception '絵の説明のフォーマットは 1 つのプロジェクトに 20 までです' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.photo_prompt_templates_limit() from public, anon, authenticated;

create trigger photo_prompt_templates_limit
  before insert on public.photo_prompt_templates
  for each row execute function public.photo_prompt_templates_limit();

alter table public.photo_prompt_templates enable row level security;

create policy "photo_prompt_templates_select_own" on public.photo_prompt_templates
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "photo_prompt_templates_insert_own" on public.photo_prompt_templates
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "photo_prompt_templates_update_own" on public.photo_prompt_templates
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "photo_prompt_templates_delete_own" on public.photo_prompt_templates
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 書ける列はポリシーと同じ操作だけ。project_id・owner_id は足すときだけ（あとから別のプロジェクトへ動かせない）
grant select, delete on public.photo_prompt_templates to authenticated;
grant insert (project_id, owner_id, name, body, is_default, position) on public.photo_prompt_templates to authenticated;
grant update (name, body, is_default, position) on public.photo_prompt_templates to authenticated;
