-- 数字の画面（F07 の段取り ②）の土台。方針は docs/architecture.md の 4.22
-- ① 手で投稿する SNS（note・Substack）の数字を、利用者が手で入れる表
-- ② 短縮リンクのクリックを SNS ごと・週ごとにまとめる関数と、クリックの多い投稿の関数（行を読んで足さず、DB で合計する）

-- ===== ① 手で入れる数字（配信先ごとに最新の 1 行） =====
create table public.manual_post_metrics (
  post_target_id uuid primary key references public.post_targets (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 閲覧（note の「ビュー」、Substack の「Views」）
  views integer check (views is null or (views >= 0 and views <= 100000000)),
  -- 反応（note の「スキ」、Substack の「Likes」）
  reactions integer check (reactions is null or (reactions >= 0 and reactions <= 100000000)),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manual_post_metrics_owner_idx on public.manual_post_metrics (owner_id);

create trigger manual_post_metrics_set_updated_at
  before update on public.manual_post_metrics
  for each row execute function public.set_updated_at();

alter table public.manual_post_metrics enable row level security;
-- 本人の、手で投稿する SNS の配信先にだけ書ける
create policy "manual_post_metrics_select_own" on public.manual_post_metrics
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "manual_post_metrics_insert_own" on public.manual_post_metrics
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.post_targets t
       where t.id = post_target_id and t.owner_id = (select auth.uid()) and public.is_manual_sns(t.sns)
    )
  );
create policy "manual_post_metrics_update_own" on public.manual_post_metrics
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "manual_post_metrics_delete_own" on public.manual_post_metrics
  for delete to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.manual_post_metrics from anon, authenticated;
grant select, insert, delete on public.manual_post_metrics to authenticated;
-- 書き換えは数字と記録した日時だけ（配信先や持ち主は変えられない）
grant update (views, reactions, recorded_at) on public.manual_post_metrics to authenticated;

-- ===== ② 短縮リンクのクリックを SNS ごとに（日本時間で今週 = 直近 7 日、先週 = その前の 7 日、30 日） =====
-- security invoker なので、RLS（本人のものだけ）が効く
create function public.link_clicks_by_sns(p_project_id uuid, p_today date)
returns table (sns text, this_week bigint, last_week bigint, last_30d bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(l.sns::text, ''),
         coalesce(sum(d.clicks) filter (where d.day > p_today - 7), 0),
         coalesce(sum(d.clicks) filter (where d.day > p_today - 14 and d.day <= p_today - 7), 0),
         coalesce(sum(d.clicks) filter (where d.day > p_today - 30), 0)
    from public.short_links l
    join public.link_click_daily d on d.link_id = l.id
   where l.project_id = p_project_id
     and d.day > p_today - 30
   group by coalesce(l.sns::text, '');
$$;

revoke execute on function public.link_clicks_by_sns(uuid, date) from public, anon, authenticated;
grant execute on function public.link_clicks_by_sns(uuid, date) to authenticated;

-- クリックの多い投稿（直近 p_days 日）。投稿の本文の短縮リンク（kind = post）だけ
create function public.top_posts_by_clicks(p_project_id uuid, p_today date, p_days integer default 30, p_limit integer default 5)
returns table (post_id uuid, clicks bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.post_id, sum(d.clicks)
    from public.short_links l
    join public.post_targets t on t.id = l.post_target_id
    join public.link_click_daily d on d.link_id = l.id
   where l.project_id = p_project_id
     and d.day > p_today - p_days
   group by t.post_id
  having sum(d.clicks) > 0
   order by sum(d.clicks) desc
   limit p_limit;
$$;

revoke execute on function public.top_posts_by_clicks(uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.top_posts_by_clicks(uuid, date, integer, integer) to authenticated;
