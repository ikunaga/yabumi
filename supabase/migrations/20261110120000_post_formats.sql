-- 投稿のフォーマット（オーナーの Notion の項目「AI と投稿のフォーマットつくれるようにする」。docs/design/post-formats.md、docs/architecture.md の 4.56、2026-11-10）。
-- プロジェクトごとに、繰り返し出す投稿の型（名前・いつ使う・本文・埋めた例・柱の名前）を登録し、投稿をつくるで選んで使い回す。本文には {穴の名前} の穴を置ける。
-- 新しく預かる情報なので、プライバシーポリシーの ②（docs/legal.md の「投稿のフォーマット」。2026-11-10 オーナーが了承）。施行まで本番に出さない。
-- 作りは絵の説明のフォーマット（20261107120000_photo_prompt_templates）にそろえた（「いつも使う」は持たない。設計の Q4）

create table public.post_formats (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  purpose text not null default '' check (char_length(purpose) <= 100),
  -- 穴は画面とサーバーで 8 種類（同じ名前は 1 つ）・名前 12 字までに確かめる。ここは同じ名前を重ねて置いた分も含めて、出てくる回数の上限だけを縛る
  body text not null check (char_length(btrim(body)) between 1 and 600 and regexp_count(body, '\{[^{}]*\}') <= 16),
  example text not null default '' check (char_length(example) <= 600),
  -- つながる投稿の柱の名前（アカウント設計の pillars.items.name。名前で持ち、なくなったら「柱なし」と読む）
  pillar text not null default '' check (char_length(pillar) <= 50),
  position integer not null default 0 check (position between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.post_formats is '投稿のフォーマット（繰り返し出す投稿の型。プロジェクトに 20 まで、1 人 100 まで）';

create index post_formats_project_idx on public.post_formats (project_id, position);
create index post_formats_owner_idx on public.post_formats (owner_id);

create trigger post_formats_set_updated_at
  before update on public.post_formats
  for each row execute function public.set_updated_at();

-- 1 つのプロジェクトに 20 まで、1 人の合計で 100 まで（photo_prompt_templates_limit と同じ作り）。同時に足されても超えないよう、
-- 数える前にそのプロジェクトの行を押さえ、利用者ごとの advisory lock を取る。security invoker なので、押さえられるのは本人が更新できる自分のプロジェクトだけ
create function public.post_formats_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.projects where id = new.project_id for update;
  if (select count(*) from public.post_formats f where f.project_id = new.project_id) >= 20 then
    raise exception '投稿のフォーマットは 1 つのプロジェクトに 20 までです' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('post_formats:' || new.owner_id::text));
  if (select count(*) from public.post_formats f where f.owner_id = new.owner_id) >= 100 then
    raise exception '投稿のフォーマットは 1 人 100 までです' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.post_formats_limit() from public, anon, authenticated;

create trigger post_formats_limit
  before insert on public.post_formats
  for each row execute function public.post_formats_limit();

alter table public.post_formats enable row level security;

create policy "post_formats_select_own" on public.post_formats
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "post_formats_insert_own" on public.post_formats
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "post_formats_update_own" on public.post_formats
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "post_formats_delete_own" on public.post_formats
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- 書ける列はポリシーと同じ操作だけ。project_id・owner_id は足すときだけ（あとから別のプロジェクトへ動かせない）
grant select, delete on public.post_formats to authenticated;
grant insert (project_id, owner_id, name, purpose, body, example, pillar, position) on public.post_formats to authenticated;
grant update (name, purpose, body, example, pillar, position) on public.post_formats to authenticated;
