-- note と Substack を「手で投稿する SNS」として加える（決定 D15）。方針は docs/architecture.md の 4.12
-- どちらも公式の投稿 API がないので、矢書は下書きと予定の管理だけを行い、投稿は利用者が手で行う。
-- 予約ジョブはこれらを拾わない。利用者が「投稿した」を押すと、送信済みとして記録する。

-- ===== 対象の SNS に note と Substack を足す =====
alter domain public.sns_key drop constraint sns_key_check;
alter domain public.sns_key add constraint sns_key_check
  check (value in ('x', 'instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'note', 'substack'));

-- 手で投稿する SNS か（アプリ側の SNS の定義と合わせる）
create function public.is_manual_sns(p_sns text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p_sns in ('note', 'substack') $$;

-- ===== 長文の SNS 用のタイトル =====
alter table public.post_targets add column title text check (title is null or char_length(title) <= 200);
grant insert (title) on public.post_targets to authenticated;
grant update (title) on public.post_targets to authenticated;

-- save_post に title を足す（p_targets: [{"sns": "note", "title": "...", "body_override": "...", "social_account_id": null}, ...]）
create or replace function public.save_post(
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

  insert into public.post_targets (post_id, sns, title, body_override, social_account_id)
  select v_post_id,
         x->>'sns',
         nullif(x->>'title', ''),
         nullif(x->>'body_override', ''),
         nullif(x->>'social_account_id', '')::uuid
    from jsonb_array_elements(p_targets) as x
  on conflict (post_id, sns) do update
    set title = excluded.title,
        body_override = excluded.body_override,
        social_account_id = excluded.social_account_id
    where public.post_targets.status = 'pending';

  return v_post_id;
end;
$$;

-- ===== 予約ジョブは、手で投稿する SNS を拾わない =====
create or replace function public.claim_due_targets(p_limit integer default 10, p_post_id uuid default null)
returns table (
  target_id uuid,
  post_id uuid,
  sns text,
  social_account_id uuid,
  account_external_id text,
  account_status text,
  body text,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 送信中のまま 10 分たったものは、送れたかどうかわからないので失敗にする（自動ではやり直さない。二重投稿を避けるため）
  update public.post_targets t
    set status = 'failed', locked_at = null,
        error_message = '送信の途中で止まりました。SNS 側に投稿されているか確かめてから、必要ならもう一度送ってください。'
    where t.status = 'publishing' and t.locked_at < now() - interval '10 minutes';

  return query
  with due as (
    select t.id
      from public.post_targets t
      join public.posts p on p.id = t.post_id
     where t.status = 'pending'
       and not public.is_manual_sns(t.sns)
       and p.status = 'scheduled'
       -- 「今すぐ送る」（p_post_id あり）は時刻を見ない。アプリと DB の時計のずれで取りこぼさないため
       and (p.planned_at <= now() or p.id = p_post_id)
       and (t.next_attempt_at is null or t.next_attempt_at <= now() or p.id = p_post_id)
       and (p_post_id is null or p.id = p_post_id)
     order by p.planned_at, t.id
     limit p_limit
     for update of t skip locked
  ),
  claimed as (
    update public.post_targets t
       set status = 'publishing', locked_at = now(), attempts = t.attempts + 1
      from due
     where t.id = due.id
    returning t.id, t.post_id, t.sns, t.social_account_id, t.body_override, t.attempts
  )
  select c.id, c.post_id, c.sns::text, c.social_account_id, a.external_id, a.status,
         coalesce(c.body_override, p.body), c.attempts
    from claimed c
    join public.posts p on p.id = c.post_id
    left join public.social_accounts a on a.id = c.social_account_id;
end;
$$;

-- ===== 手で投稿したことを記録する =====
-- 送信の状態は利用者が直接書き換えられない（4.7）ので、本人の・手で投稿する SNS の配信先だけを、この関数で「送信済み」にする
create function public.mark_manual_target_posted(p_target_id uuid, p_url text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_url is not null and p_url <> '' and (p_url !~ '^https://' or char_length(p_url) > 2000) then
    raise exception 'invalid url' using errcode = '22023';
  end if;
  update public.post_targets t
     set status = 'published', published_at = now(), external_url = nullif(p_url, ''), error_message = null
   where t.id = p_target_id
     and t.owner_id = (select auth.uid())
     and public.is_manual_sns(t.sns)
     and t.status in ('pending', 'failed');
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.mark_manual_target_posted(uuid, text) from public, anon;
grant execute on function public.mark_manual_target_posted(uuid, text) to authenticated;

-- ===== プロジェクトで使う「手で投稿する SNS」のプロフィール =====
-- つなぐ（OAuth）のかわりに、プロフィールの URL を登録できる（任意）。Substack の投稿画面を開くのにも使う
create table public.project_manual_channels (
  project_id uuid not null references public.projects (id) on delete cascade,
  sns public.sns_key not null check (public.is_manual_sns(sns)),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_url text check (profile_url is null or (profile_url ~ '^https://' and char_length(profile_url) <= 500)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, sns)
);

create trigger project_manual_channels_set_updated_at
  before update on public.project_manual_channels
  for each row execute function public.set_updated_at();

alter table public.project_manual_channels enable row level security;

create policy "project_manual_channels_select_own" on public.project_manual_channels
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "project_manual_channels_insert_own" on public.project_manual_channels
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "project_manual_channels_update_own" on public.project_manual_channels
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "project_manual_channels_delete_own" on public.project_manual_channels
  for delete to authenticated using ((select auth.uid()) = owner_id);
