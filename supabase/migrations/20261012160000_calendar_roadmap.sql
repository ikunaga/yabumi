-- ロードマップのやることをカレンダーに出す（F06・F10、オーナーの決定 2026-10-12。docs/architecture.md の 4.23）
-- 1. やることに予定日（任意。その週の中の日）を持たせる
-- 2. 投稿をやることに結びつける（やることから投稿をつくったとき）。同じプロジェクトのやることだけ
-- 3. やることの進み具合を DB で数える（roadmap_item_progress）。数え方は counted_post_targets（4.23 の 1 か所）

-- ===== 予定日 =====
alter table public.roadmap_items add column planned_on date;
alter table public.roadmap_items add constraint roadmap_items_planned_on_in_week
  check (planned_on is null or planned_on between week_start and week_start + 6);

-- 週を変えたら、その週に入らない予定日は外す（週の中の日だけを持つ）
create function public.roadmap_items_clear_planned_on() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.planned_on is not null and (new.planned_on < new.week_start or new.planned_on > new.week_start + 6) then
    new.planned_on := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.roadmap_items_clear_planned_on() from public, anon, authenticated;

create trigger roadmap_items_clear_planned_on
  before update of week_start on public.roadmap_items
  for each row execute function public.roadmap_items_clear_planned_on();

-- ===== 投稿とやることの結びつき =====
alter table public.posts add column roadmap_item_id uuid references public.roadmap_items (id) on delete set null;
create index posts_roadmap_item_idx on public.posts (roadmap_item_id) where roadmap_item_id is not null;

-- 結びつけられるのは、同じプロジェクトのやることだけ（RLS の上に、ほかの人・ほかのプロジェクトのやることを指せないようにする）
create function public.posts_check_roadmap_item() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.roadmap_item_id is not null and not exists (
    select 1 from public.roadmap_items i where i.id = new.roadmap_item_id and i.project_id = new.project_id and i.owner_id = new.owner_id
  ) then
    raise exception 'roadmap item must belong to the same project' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.posts_check_roadmap_item() from public, anon, authenticated;

create trigger posts_check_roadmap_item
  before insert or update of roadmap_item_id, project_id on public.posts
  for each row execute function public.posts_check_roadmap_item();

-- ===== やることの進み具合 =====
-- p_from〜p_to に週が始まるやることごとに、数える配信先の数を返す。
-- - 「投稿した回数」のやること: その週に送った（予約した）配信先（SNS を決めていればその SNS だけ）と、そのやることに結びついた投稿の配信先を、
--   重ならないように（配信先ごとに 1 回）数える。結びついた投稿が週のあとに送られても、そのやることに数える
-- - ほかのやること: 結びついた投稿の配信先だけ
-- linked_* は、そのうち結びついた投稿のもの。結びついた投稿を見るのは、やることの週の 31 日前から 92 日後まで
-- security invoker なので RLS（本人のものだけ）が効く。行を読んで足さず、DB で数える
create function public.roadmap_item_progress(p_project_id uuid, p_from date, p_to date)
returns table (item_id uuid, published bigint, scheduled bigint, linked_published bigint, linked_scheduled bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with items as (
    select i.id, i.week_start, i.sns::text as sns, i.kpi
      from public.roadmap_items i
     where i.project_id = p_project_id
       and i.week_start between p_from and p_to
  ),
  c as (
    select c.target_id, c.sns, c.day, c.state, p.roadmap_item_id
      from public.counted_post_targets(p_project_id, p_from - 31, p_to + 98) c
      join public.post_targets t on t.id = c.target_id
      join public.posts p on p.id = t.post_id
  ),
  m as (
    select i.id as item_id, c.target_id, c.state, coalesce(c.roadmap_item_id = i.id, false) as linked
      from items i
      join c on (i.sns is null or c.sns = i.sns)
            and ((i.kpi = 'posts' and c.day between i.week_start and i.week_start + 6) or c.roadmap_item_id = i.id)
  )
  select m.item_id,
         count(distinct m.target_id) filter (where m.state = 'published'),
         count(distinct m.target_id) filter (where m.state = 'scheduled'),
         count(distinct m.target_id) filter (where m.state = 'published' and m.linked),
         count(distinct m.target_id) filter (where m.state = 'scheduled' and m.linked)
    from m
   group by m.item_id;
$$;

comment on function public.roadmap_item_progress(uuid, date, date) is 'ロードマップのやることの進み具合（週の投稿と、結びついた投稿を重ならないように数える）';

revoke execute on function public.roadmap_item_progress(uuid, date, date) from public, anon, authenticated;
grant execute on function public.roadmap_item_progress(uuid, date, date) to authenticated;
