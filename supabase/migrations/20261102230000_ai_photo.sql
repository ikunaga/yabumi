-- AI で写真・絵をつくる（docs/architecture.md の 4.25 の ②、決定 D35）。
-- ① ai_image_jobs: 画像の AI を 1 回呼ぶごとの予約と記録。上限（利用者ごとの月の枚数・yabumi 全体の月の費用）は
--    reserve_ai_images が、全体で 1 本のロックの中で数えてから予約する（同時に押されても超えない）。Claude の ai_usage とは別に数える
--    （画像を使う人が多い月に、ほかの AI 機能を止めないため。D25 の I3）
-- ② ai_image_notices: 注意（実在の人に似せない・本物の写真のように見せない・SNS の AI の表示）を読んだ記録。1 人 1 回
-- ③ media_files.ai_generated: AI で作った画像（画面の札と、画像の中の IPTC の印の目印）。サーバーだけが入れる

-- ===== ① =====
create table public.ai_image_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  model text not null,
  -- 予約した枚数。終わったら実際にできた枚数に直す
  images integer not null check (images between 0 and 4),
  cost_usd numeric(10, 6) not null default 0,
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  -- できた候補の置き場所（post-media の <利用者の ID>/gen/<乱数>.jpg）。1 日で片付ける（cleanup_media_candidates が、記録のないファイルとして消す）
  storage_paths text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index ai_image_jobs_owner_idx on public.ai_image_jobs (owner_id, created_at);
create index ai_image_jobs_created_idx on public.ai_image_jobs (created_at);

alter table public.ai_image_jobs enable row level security;
create policy "ai_image_jobs_select_own" on public.ai_image_jobs
  for select to authenticated using ((select auth.uid()) = owner_id);
-- 書くのはサーバー（service_role）だけ
grant select on public.ai_image_jobs to authenticated;

-- ===== ② =====
create table public.ai_image_notices (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  acknowledged_at timestamptz not null default now()
);

alter table public.ai_image_notices enable row level security;
create policy "ai_image_notices_select_own" on public.ai_image_notices
  for select to authenticated using ((select auth.uid()) = owner_id);
grant select on public.ai_image_notices to authenticated;

-- ===== ③ =====
alter table public.media_files add column ai_generated boolean not null default false;

-- ===== 予約 =====
-- 上限はここで固定する（呼び出し側から渡さない。オーナーの決定 D35: 1 人 月 20 枚、yabumi 全体で 月 1,000 円 = $6.66。料金プランを始めるときに見直す）。
-- 画面に出す値は src/lib/ai/photo.ts の PHOTO_LIMITS（同じ値にそろえ、テストで確かめる）。
-- 上限を超えるなら予約せず、理由を返す。p_scope_owner を入れると、全体の費用をその利用者の分だけで数える（結合テストで、同じ DB の他のテストに左右されないため）。
-- 予約（reserved）のまま残ったもの（途中で落ちたなど）も数える（多めに数えて、上限を超えない側に倒す）
create function public.reserve_ai_images(
  p_owner_id uuid,
  p_project_id uuid,
  p_model text,
  p_images integer,
  p_cost_usd numeric,
  p_scope_owner uuid default null
)
returns table (job_id uuid, status text, user_month_images integer, global_month_usd numeric)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_user_monthly_images constant integer := 20;
  c_global_monthly_usd constant numeric := 6.66;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_user integer;
  v_global numeric;
  v_id uuid;
begin
  if p_images < 1 or p_images > 4 or p_cost_usd is null or p_cost_usd <= 0 then
    raise exception 'images out of range' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_image_jobs'));
  select coalesce(sum(j.images), 0)::integer into v_user
    from public.ai_image_jobs j
   where j.owner_id = p_owner_id and j.created_at >= v_month_start and j.status <> 'failed';
  select coalesce(sum(j.cost_usd), 0) into v_global
    from public.ai_image_jobs j
   where j.created_at >= v_month_start and j.status <> 'failed'
     and (p_scope_owner is null or j.owner_id = p_scope_owner);
  if v_global + p_cost_usd > c_global_monthly_usd then
    return query select null::uuid, 'global_limit'::text, v_user, v_global;
    return;
  end if;
  if v_user + p_images > c_user_monthly_images then
    return query select null::uuid, 'user_limit'::text, v_user, v_global;
    return;
  end if;
  insert into public.ai_image_jobs (owner_id, project_id, model, images, cost_usd)
  values (p_owner_id, p_project_id, p_model, p_images, p_cost_usd)
  returning id into v_id;
  return query select v_id, 'ok'::text, v_user + p_images, v_global + p_cost_usd;
end;
$$;

revoke execute on function public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_images(uuid, uuid, text, integer, numeric, uuid) to service_role;
