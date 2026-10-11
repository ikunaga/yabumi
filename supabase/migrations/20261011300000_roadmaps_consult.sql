-- ロードマップ（F10）と、AI と相談（F09）の会話の用途（docs/architecture.md の 4.23）。

-- ===== AI と相談の会話 =====
alter table public.ai_threads drop constraint ai_threads_purpose_check;
alter table public.ai_threads add constraint ai_threads_purpose_check check (purpose in ('account_plan', 'post_ideas', 'consult'));

-- ===== ロードマップ: プロジェクトごとの目標（KGI）と、追いかける数字（KPI）の週の目標 =====
create table public.roadmaps (
  project_id uuid primary key references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- { "statement": "3 か月で 100 ダウンロード", "kpi": "downloads", "target": 100, "deadline": "2027-01-31" }。決めていなければ null
  kgi jsonb check (kgi is null or (jsonb_typeof(kgi) = 'object' and pg_column_size(kgi) <= 4096)),
  -- [{ "kpi": "posts", "per_week": 3 }]（3 つまで）
  kpi_targets jsonb not null default '[]'::jsonb check (jsonb_typeof(kpi_targets) = 'array' and jsonb_array_length(kpi_targets) <= 3),
  -- 数字を数え始める日（KGI の進み具合は、この日から今日までの合計）
  started_on date not null default (now() at time zone 'Asia/Tokyo')::date,
  -- 最後に目標を決めたのが AI の案か、手か
  source text not null default 'manual' check (source in ('ai', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.roadmaps is 'ロードマップの目標（KGI）と KPI の週の目標。プロジェクトごとに 1 行（4.23）';

create trigger roadmaps_set_updated_at
  before update on public.roadmaps
  for each row execute function public.set_updated_at();

alter table public.roadmaps enable row level security;

create policy "roadmaps_select_own" on public.roadmaps
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "roadmaps_insert_own" on public.roadmaps
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "roadmaps_update_own" on public.roadmaps
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "roadmaps_delete_own" on public.roadmaps
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ===== ロードマップ: 週ごとのやること =====
create table public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  detail text not null default '' check (char_length(detail) <= 1000),
  -- その週の月曜（日本時間）
  week_start date not null check (extract(isodow from week_start) = 1),
  -- 結びつける KPI と目標の値（任意）。数字から進み具合を自動で出す
  kpi text check (kpi is null or kpi in ('posts', 'link_clicks', 'views', 'followers', 'store_page_views', 'downloads', 'revenue')),
  target numeric check (target is null or (target > 0 and target <= 1000000)),
  status text not null default 'todo' check (status in ('todo', 'done', 'skipped')),
  done_at timestamptz,
  position integer not null default 0,
  source text not null default 'manual' check (source in ('ai', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kpi is null) = (target is null))
);

comment on table public.roadmap_items is 'ロードマップの週ごとのやること（4.23）';

create index roadmap_items_project_week_idx on public.roadmap_items (project_id, week_start, position);

create trigger roadmap_items_set_updated_at
  before update on public.roadmap_items
  for each row execute function public.set_updated_at();

alter table public.roadmap_items enable row level security;

create policy "roadmap_items_select_own" on public.roadmap_items
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "roadmap_items_insert_own" on public.roadmap_items
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "roadmap_items_update_own" on public.roadmap_items
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy "roadmap_items_delete_own" on public.roadmap_items
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- ===== 権限（4.17）: ログインした利用者に、ポリシーと同じ操作だけ。anon には何も与えない =====
revoke all on table public.roadmaps, public.roadmap_items from anon, authenticated;
grant select, insert, update, delete on public.roadmaps to authenticated;
grant select, insert, update, delete on public.roadmap_items to authenticated;
grant all on table public.roadmaps, public.roadmap_items to service_role;

-- ===== ロードマップの進み具合: 日ごとの数字（自動で出せるものだけ） =====
-- 投稿した回数（送信済みの配信先）と、ストアへのクリック（短縮リンク）。日は日本時間。
-- security invoker なので、RLS（本人のものだけ）が効く。行を読んで足さず、DB で日ごとに合計する（1 年分まで）
create function public.roadmap_daily_totals(p_project_id uuid, p_from date, p_to date)
returns table (day date, posts bigint, link_clicks bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select d::date as day
      from generate_series(p_from, least(p_to, p_from + 400), interval '1 day') d
  ),
  posted as (
    select (t.published_at at time zone 'Asia/Tokyo')::date as day, count(*) as n
      from public.post_targets t
      join public.posts p on p.id = t.post_id
     where p.project_id = p_project_id
       and t.status = 'published'
       and t.published_at is not null
       and (t.published_at at time zone 'Asia/Tokyo')::date between p_from and p_to
     group by 1
  ),
  clicked as (
    select c.day, sum(c.clicks) as n
      from public.link_click_daily c
      join public.short_links l on l.id = c.link_id
     where l.project_id = p_project_id
       and c.day between p_from and p_to
     group by 1
  )
  select days.day, coalesce(posted.n, 0), coalesce(clicked.n, 0)
    from days
    left join posted on posted.day = days.day
    left join clicked on clicked.day = days.day
   order by days.day;
$$;

revoke execute on function public.roadmap_daily_totals(uuid, date, date) from public, anon, authenticated;
grant execute on function public.roadmap_daily_totals(uuid, date, date) to authenticated;
