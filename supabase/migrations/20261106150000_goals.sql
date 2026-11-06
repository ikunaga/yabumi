-- 目標（KGI）・中間の目標・KPI と行動の目標を、プロジェクトに 1 行の roadmaps（jsonb）から、それぞれの表に移す（段階 ①。docs/design/goals-model.md、2026-11-06 オーナーの了承）。
-- - goals: KGI。プロジェクトに複数持て、active は 1 つだけ（部分ユニーク）。KGI をまだ決めていない active な goal も許す（週の回数・やることだけの人）
-- - goal_milestones: 4 週ごとの中間の目標（＝ 伴走の区切り。いまの first_month.startedOn を移す）
-- - goal_kpis: KPI（role = kpi、1〜3 個）と行動の目標（role = action、SNS ごとの投稿の週の本数。いまの first_month.weekly と kpi_targets の posts）
-- - roadmap_items.goal_id: どの目標のためのやることか（on delete cascade）
-- 状態・結果の値・閉じた日時・区切りの日付はサーバーが決めるので、3 つの表は本人に select だけを与え、書くのは security definer の関数だけにする。
-- roadmaps と account_plans には触らずに写す（段階 ① を戻すときは、この版で足したものを消すだけ。docs/design/goals-model.md の 3.）。
-- 段階 ② のコードが出るまで、前のコードは roadmaps と first_month に書き続けるので、橋渡しのトリガーで goals に写す（段階 ④ で消す）

-- ===== 数字の種類の決まり（表の check と関数で同じものを使う） =====
create function public.goal_metric_valid(p_role text, p_metric text, p_action text, p_sns public.sns_key)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_metric in ('posts', 'link_clicks', 'downloads', 'store_page_views', 'revenue', 'outcomes', 'followers', 'views')
     and (p_metric = 'outcomes') = (p_action is not null)
     and (p_action is null or p_action in ('purchase', 'signup', 'booking', 'inquiry', 'visit'))
     and (p_sns is null or p_metric in ('posts', 'followers', 'views'))
     and case p_role
           when 'kgi' then true
           when 'kpi' then p_metric <> 'posts'
           when 'action' then p_metric = 'posts'
           else false
         end;
$$;

revoke all on function public.goal_metric_valid(text, text, text, public.sns_key) from public, anon, authenticated, service_role;
grant execute on function public.goal_metric_valid(text, text, text, public.sns_key) to authenticated, service_role;

-- ===== KGI =====
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  statement text check (statement is null or char_length(statement) between 1 and 120),
  metric text,
  action text,
  sns public.sns_key,
  target numeric check (target is null or (target > 0 and target <= 10000000)),
  starts_on date not null,
  ends_on date,
  status text not null default 'active' check (status in ('active', 'achieved', 'expired', 'replaced')),
  result_value numeric check (result_value is null or result_value >= 0),
  closed_at timestamptz,
  provisional boolean not null default false,
  source text not null default 'manual' check (source in ('ai', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- KGI は全部あるか、全部ない（まだ決めていない）
  check ((statement is null) = (metric is null) and (metric is null) = (target is null) and (target is null) = (ends_on is null)),
  check (metric is null or public.goal_metric_valid('kgi', metric, action, sns)),
  check (metric is not null or (action is null and sns is null and not provisional)),
  check (ends_on is null or (ends_on > starts_on and ends_on <= starts_on + 371)),
  check ((status = 'active') = (closed_at is null)),
  check (status <> 'active' or result_value is null)
);

comment on table public.goals is '目標（KGI）。active は 1 つだけ。状態・結果はサーバーが決める（関数でだけ書く）。docs/design/goals-model.md';

create unique index goals_one_active_idx on public.goals (project_id) where status = 'active';
create index goals_project_idx on public.goals (project_id, starts_on desc);

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ===== 中間の目標（4 週ごと ＝ 伴走の区切り） =====
create table public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  seq integer not null check (seq between 1 and 60),
  starts_on date not null check (extract(isodow from starts_on) = 1),
  ends_on date not null,
  target numeric check (target is null or (target > 0 and target <= 10000000)),
  result_value numeric check (result_value is null or result_value >= 0),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (goal_id, seq),
  -- 結果は区切りを過ぎてからサーバーが入れる（KGI まだの目標は、数える数字がないので null のまま settled_at だけ入れる）
  check (ends_on >= starts_on and ends_on <= starts_on + 27),
  check (result_value is null or settled_at is not null)
);

comment on table public.goal_milestones is '中間の目標（4 週ごと。伴走の区切りと同じ）。結果はサーバーが数える';

create index goal_milestones_goal_idx on public.goal_milestones (goal_id, starts_on);

-- ===== KPI と行動の目標 =====
create table public.goal_kpis (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('kpi', 'action')),
  metric text not null,
  action text,
  sns public.sns_key,
  per_week numeric not null check (per_week > 0 and per_week <= 1000000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check (public.goal_metric_valid(role, metric, action, sns)),
  -- 投稿の週の本数は 1〜14 の整数（アカウント設計の MAX_WEEKLY_PER_SNS と同じ）
  check (role <> 'action' or (per_week = round(per_week) and per_week between 1 and 14))
);

comment on table public.goal_kpis is 'KPI（role = kpi、1〜3 個）と行動の目標（role = action、SNS ごとの投稿の週の本数。伴走が追いかける）';

create unique index goal_kpis_unique_idx on public.goal_kpis (goal_id, role, metric, coalesce(action, ''), coalesce(sns::text, ''));

-- ===== RLS と権限（本人は読むだけ。書くのは下の関数） =====
alter table public.goals enable row level security;
alter table public.goal_milestones enable row level security;
alter table public.goal_kpis enable row level security;

create policy "goals_select_own" on public.goals for select to authenticated using ((select auth.uid()) = owner_id);
create policy "goal_milestones_select_own" on public.goal_milestones for select to authenticated using ((select auth.uid()) = owner_id);
create policy "goal_kpis_select_own" on public.goal_kpis for select to authenticated using ((select auth.uid()) = owner_id);

revoke all on table public.goals, public.goal_milestones, public.goal_kpis from public, anon, authenticated;
grant select on public.goals, public.goal_milestones, public.goal_kpis to authenticated;
grant all on table public.goals, public.goal_milestones, public.goal_kpis to service_role;

-- 中間の目標と KPI の owner_id は、goal と同じ人（関数の外から service_role で書いても崩れないように）
create function public.goal_child_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.goals g where g.id = new.goal_id and g.owner_id = new.owner_id) then
    raise exception 'goal owner mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.goal_child_check_owner() from public, anon, authenticated, service_role;

create trigger goal_milestones_check_owner before insert or update of goal_id, owner_id on public.goal_milestones
  for each row execute function public.goal_child_check_owner();
create trigger goal_kpis_check_owner before insert or update of goal_id, owner_id on public.goal_kpis
  for each row execute function public.goal_child_check_owner();

-- ===== やることを目標につなぐ =====
alter table public.roadmap_items
  add column goal_id uuid references public.goals (id) on delete cascade,
  add column action text;

-- 手で入れる成果（outcomes）も、やることの数字にできるようにする（zod の KPI_KEYS との食い違いを直す）
alter table public.roadmap_items drop constraint roadmap_items_kpi_check;
alter table public.roadmap_items
  add constraint roadmap_items_kpi_check check (kpi is null or kpi in ('posts', 'link_clicks', 'views', 'followers', 'store_page_views', 'downloads', 'revenue', 'outcomes')),
  add constraint roadmap_items_action_only_outcomes check ((kpi = 'outcomes') = (action is not null) or (kpi is null and action is null)),
  add constraint roadmap_items_action_valid check (action is null or action in ('purchase', 'signup', 'booking', 'inquiry', 'visit'));

create index roadmap_items_goal_idx on public.roadmap_items (goal_id);

-- KGI をまだ決めていない active な goal を作る（なければ）。橋渡しと写し替えで使う。サーバーだけ
create function public.ensure_active_goal(p_project_id uuid, p_owner_id uuid, p_starts_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- start_goal と同じロック（目標を替えている最中に、閉じる前の目標を拾わない。同じトランザクションの中なら取り直しても待たない）
  perform pg_advisory_xact_lock(hashtext('goals:' || p_project_id::text));
  select g.id into v_id from public.goals g where g.project_id = p_project_id and g.status = 'active';
  if v_id is not null then
    return v_id;
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id) then
    raise exception 'project owner mismatch' using errcode = '42501';
  end if;
  insert into public.goals (project_id, owner_id, starts_on)
  values (p_project_id, p_owner_id, coalesce(p_starts_on, (now() at time zone 'Asia/Tokyo')::date))
  on conflict (project_id) where status = 'active' do nothing
  returning id into v_id;
  if v_id is null then
    select g.id into v_id from public.goals g where g.project_id = p_project_id and g.status = 'active';
  end if;
  return v_id;
end;
$$;

revoke all on function public.ensure_active_goal(uuid, uuid, date) from public, anon, authenticated, service_role;

-- やることの目標: 同じプロジェクト・同じ人の goal だけ。新しく足すやることは active な goal だけ。
-- goal_id なしで足したら（段階 ② より前のコード）、active な goal に入れる（なければ KGI まだの goal を作る。段階 ④ で not null にしたら消す）
create function public.roadmap_items_check_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- start_goal と同じロック（替えている最中の目標に、やることをつながない）
  perform pg_advisory_xact_lock(hashtext('goals:' || new.project_id::text));
  if new.goal_id is null then
    new.goal_id := public.ensure_active_goal(new.project_id, new.owner_id, new.week_start);
  end if;
  if not exists (
    select 1 from public.goals g
     where g.id = new.goal_id and g.project_id = new.project_id and g.owner_id = new.owner_id
       and (tg_op = 'UPDATE' or g.status = 'active')
  ) then
    raise exception 'invalid goal for roadmap item' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.roadmap_items_check_goal() from public, anon, authenticated, service_role;

-- ===== 数える（サーバーが数える 1 か所。security invoker で本人のプロジェクトだけ） =====
-- value: p_from〜p_to（今日より後は数えない）の数字。followers は増えた人数、revenue は数えた最後の日の直近 28 日の売上（RevenueCat）。
-- counted_through: 数えた最後の日（ストアは届いている日まで。手で入れる成果は入れた最後の日）。数字がなければ null。
-- available: 取り込み元がある（つないでいる・成果の欄がある）。false なら画面は数字の代わりに案内を出す
create function public.goal_metric_total(p_project_id uuid, p_metric text, p_action text, p_sns public.sns_key, p_from date, p_to date)
returns table (value numeric, counted_through date, available boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_to date := least(p_to, (now() at time zone 'Asia/Tokyo')::date);
begin
  if p_from is null or v_to is null or p_from > v_to then
    return query select 0::numeric, null::date, true;
    return;
  end if;
  if p_metric = 'posts' then
    return query
      select count(*)::numeric, v_to, true
        from public.counted_post_targets(p_project_id, p_from, v_to) c
       where c.state = 'published' and (p_sns is null or c.sns = p_sns::text);
  elsif p_metric = 'link_clicks' then
    return query
      select coalesce(sum(c.clicks), 0)::numeric, v_to, true
        from public.link_click_daily c
        join public.short_links l on l.id = c.link_id
       where l.project_id = p_project_id and c.day between p_from and v_to;
  elsif p_metric in ('downloads', 'store_page_views') then
    return query
      with rows as (
        select d.day, d."values"
          from public.store_daily d
         where d.project_id = p_project_id
           and d.source in (case when p_metric = 'downloads' then 'app_store' else 'app_store_views' end, 'google_play')
      )
      select coalesce(sum((r."values" ->> case when p_metric = 'downloads' then 'downloads' else 'page_views' end)::numeric) filter (where r.day between p_from and v_to), 0),
             max(r.day) filter (where r.day <= v_to),
             exists (select 1 from rows)
        from rows r;
  elsif p_metric = 'revenue' then
    return query
      select coalesce((select (d."values" ->> 'revenue')::numeric from public.store_daily d
                        where d.project_id = p_project_id and d.source = 'revenuecat' and d.day <= v_to order by d.day desc limit 1), 0),
             (select max(d.day) from public.store_daily d where d.project_id = p_project_id and d.source = 'revenuecat' and d.day <= v_to),
             exists (select 1 from public.store_daily d where d.project_id = p_project_id and d.source = 'revenuecat');
  elsif p_metric = 'outcomes' then
    return query
      select coalesce(sum(o.count) filter (where o.day between p_from and v_to), 0)::numeric,
             max(o.day) filter (where o.day between p_from and v_to),
             true
        from public.project_outcomes_daily o
       where o.project_id = p_project_id and o.action = p_action;
  elsif p_metric = 'followers' then
    return query
      with accounts as (
        select psa.social_account_id
          from public.project_social_accounts psa
          join public.social_accounts a on a.id = psa.social_account_id
         where psa.project_id = p_project_id and (p_sns is null or a.sns = p_sns)
      ),
      first_f as (
        select distinct on (am.social_account_id) am.social_account_id, (am."values" ->> 'followers')::numeric as f
          from public.account_metrics am join accounts using (social_account_id)
         where am.day between p_from and v_to and am."values" ? 'followers'
         order by am.social_account_id, am.day
      ),
      last_f as (
        select distinct on (am.social_account_id) am.social_account_id, (am."values" ->> 'followers')::numeric as f, am.day
          from public.account_metrics am join accounts using (social_account_id)
         where am.day between p_from and v_to and am."values" ? 'followers'
         order by am.social_account_id, am.day desc
      )
      select coalesce(sum(greatest(l.f - fi.f, 0)), 0), max(l.day),
             exists (select 1 from public.account_metrics am join accounts using (social_account_id))
        from last_f l join first_f fi using (social_account_id);
  elsif p_metric = 'views' then
    return query
      with latest as (
        select distinct on (m.post_target_id) (m."values" ->> 'views')::numeric as views, m.captured_at
          from public.post_metrics m
          join public.post_targets t on t.id = m.post_target_id
          join public.posts p on p.id = t.post_id
         where p.project_id = p_project_id
           and (p_sns is null or t.sns = p_sns)
           and (t.published_at at time zone 'Asia/Tokyo')::date between p_from and v_to
           and m."values" ? 'views'
         order by m.post_target_id, m.day_index desc
      )
      select coalesce(sum(l.views), 0), (max(l.captured_at) at time zone 'Asia/Tokyo')::date, exists (select 1 from latest)
        from latest l;
  else
    raise exception 'unknown metric %', p_metric using errcode = '22023';
  end if;
end;
$$;

comment on function public.goal_metric_total(uuid, text, text, public.sns_key, date, date) is '目標・中間の目標・KPI の数字を数える 1 か所（docs/design/goals-model.md の 2.3）';

revoke all on function public.goal_metric_total(uuid, text, text, public.sns_key, date, date) from public, anon, authenticated, service_role;
grant execute on function public.goal_metric_total(uuid, text, text, public.sns_key, date, date) to authenticated, service_role;

-- ===== 書く関数（本人は auth.uid()。状態・結果・日付はここで決める） =====

-- 目標を閉じる（結果を数えて、達成・期限切れ・見直し（replaced）を決める）。中の関数から呼ぶだけ
create function public.close_goal_internal(p_goal_id uuid, p_replacing boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.goals;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_result numeric;
  v_status text;
begin
  select * into g from public.goals where id = p_goal_id and status = 'active' for update;
  if not found then
    return;
  end if;
  if g.metric is not null then
    select t.value into v_result from public.goal_metric_total(g.project_id, g.metric, g.action, g.sns, g.starts_on, least(g.ends_on, v_today)) t;
  end if;
  v_status := case
    when g.metric is not null and v_result >= g.target then 'achieved'
    when g.ends_on is not null and g.ends_on < v_today then 'expired'
    when p_replacing then 'replaced'
    else 'expired'
  end;
  -- 区切りの結果も数えて入れる（過ぎた区切りで、まだ数えていないもの）
  update public.goal_milestones m
     set result_value = coalesce((select t.value from public.goal_metric_total(g.project_id, g.metric, g.action, g.sns, m.starts_on, m.ends_on) t), 0),
         settled_at = now()
   where m.goal_id = g.id and m.settled_at is null and g.metric is not null and m.starts_on <= v_today;
  update public.goals set status = v_status, result_value = case when g.metric is null then null else coalesce(v_result, 0) end, closed_at = now()
   where id = g.id;
end;
$$;

revoke all on function public.close_goal_internal(uuid, boolean) from public, anon, authenticated, service_role;

-- KPI・行動の目標を、渡した役目の分だけ入れ替える（中の関数から呼ぶ。p_kpis は [{metric, action, sns, per_week}]）
create function public.replace_goal_kpis_internal(p_goal_id uuid, p_owner_id uuid, p_role text, p_kpis jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_kpis is null or jsonb_typeof(p_kpis) <> 'array' then
    raise exception 'invalid kpis' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_kpis);
  if (p_role = 'kpi' and v_count > 3) or (p_role = 'action' and v_count > 7) then
    raise exception 'too many kpis' using errcode = '22023';
  end if;
  delete from public.goal_kpis where goal_id = p_goal_id and role = p_role;
  insert into public.goal_kpis (goal_id, owner_id, role, metric, action, sns, per_week, position)
  select p_goal_id, p_owner_id, p_role,
         case when p_role = 'action' then 'posts' else k.value ->> 'metric' end,
         nullif(k.value ->> 'action', ''),
         nullif(k.value ->> 'sns', '')::public.sns_key,
         (k.value ->> 'per_week')::numeric,
         (k.ordinality - 1)::integer
    from jsonb_array_elements(p_kpis) with ordinality k;
end;
$$;

revoke all on function public.replace_goal_kpis_internal(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- 新しい目標を始める（AI の採用・手で決める）。いまの active は結果を数えて閉じる。
-- p_goal: {statement, metric, action, sns, target, weeks, provisional}（null なら KGI まだ）。期間は今週の月曜から weeks 週（4〜52）。
-- p_milestones: [target, ...]（4 週ごと。null の要素は目標なし）。p_kpis: KPI の配列（null なら前のものを引き継がない）。
-- p_actions: 行動の目標の配列（null なら前の goal のものを引き継ぐ）
create function public.start_goal(p_project_id uuid, p_goal jsonb, p_milestones jsonb, p_kpis jsonb, p_actions jsonb, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_monday date := v_today - (extract(isodow from v_today)::integer - 1);
  v_prev uuid;
  v_id uuid;
  v_weeks integer;
  v_ms integer;
begin
  if v_uid is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_uid) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  if p_source not in ('ai', 'manual') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('goals:' || p_project_id::text));
  select g.id into v_prev from public.goals g where g.project_id = p_project_id and g.status = 'active';
  if v_prev is not null then
    perform public.close_goal_internal(v_prev, true);
  end if;

  if p_goal is null or jsonb_typeof(p_goal) = 'null' then
    insert into public.goals (project_id, owner_id, starts_on, source)
    values (p_project_id, v_uid, v_monday, p_source)
    returning id into v_id;
    v_weeks := 4;
  else
    v_weeks := coalesce((p_goal ->> 'weeks')::integer, 12);
    if v_weeks < 4 or v_weeks > 52 then
      raise exception 'invalid weeks' using errcode = '22023';
    end if;
    insert into public.goals (project_id, owner_id, statement, metric, action, sns, target, starts_on, ends_on, provisional, source)
    values (
      p_project_id, v_uid,
      p_goal ->> 'statement', p_goal ->> 'metric', nullif(p_goal ->> 'action', ''), nullif(p_goal ->> 'sns', '')::public.sns_key,
      (p_goal ->> 'target')::numeric, v_monday, v_monday + v_weeks * 7 - 1,
      coalesce((p_goal ->> 'provisional')::boolean, false), p_source
    )
    returning id into v_id;
  end if;

  -- 中間の目標: 4 週ごと（最後の区切りは期限まで）
  v_ms := greatest(1, ceil(v_weeks / 4.0)::integer);
  insert into public.goal_milestones (goal_id, owner_id, seq, starts_on, ends_on, target)
  select v_id, v_uid, s, v_monday + (s - 1) * 28, least(v_monday + s * 28 - 1, v_monday + v_weeks * 7 - 1),
         case when p_milestones is not null and jsonb_typeof(p_milestones) = 'array' then nullif(p_milestones ->> (s - 1), '')::numeric end
    from generate_series(1, v_ms) s;

  if p_kpis is not null and jsonb_typeof(p_kpis) = 'array' then
    perform public.replace_goal_kpis_internal(v_id, v_uid, 'kpi', p_kpis);
  end if;
  if p_actions is not null and jsonb_typeof(p_actions) = 'array' then
    perform public.replace_goal_kpis_internal(v_id, v_uid, 'action', p_actions);
  elsif v_prev is not null then
    insert into public.goal_kpis (goal_id, owner_id, role, metric, action, sns, per_week, position)
    select v_id, v_uid, k.role, k.metric, k.action, k.sns, k.per_week, k.position
      from public.goal_kpis k where k.goal_id = v_prev and k.role = 'action';
  end if;
  return v_id;
end;
$$;

revoke all on function public.start_goal(uuid, jsonb, jsonb, jsonb, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.start_goal(uuid, jsonb, jsonb, jsonb, jsonb, text) to authenticated;

-- active な目標を見直す（文・目標の値・期限と、まだ始まっていない区切りの目標）。p_milestones は {seq: target} の object（なければ変えない）
create function public.revise_goal(p_goal_id uuid, p_statement text, p_target numeric, p_ends_on date, p_milestones jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  g public.goals;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  select * into g from public.goals where id = p_goal_id and owner_id = v_uid and status = 'active' for update;
  if not found or g.metric is null then
    raise exception 'goal not found' using errcode = '42501';
  end if;
  if p_ends_on is not null and p_ends_on < v_today then
    raise exception 'invalid ends_on' using errcode = '22023';
  end if;
  update public.goals
     set statement = coalesce(p_statement, statement), target = coalesce(p_target, target), ends_on = coalesce(p_ends_on, ends_on)
   where id = g.id;
  if p_milestones is not null and jsonb_typeof(p_milestones) = 'object' then
    update public.goal_milestones m
       set target = nullif(p_milestones ->> m.seq::text, '')::numeric
     where m.goal_id = g.id and m.starts_on > v_today and p_milestones ? m.seq::text;
  end if;
end;
$$;

revoke all on function public.revise_goal(uuid, text, numeric, date, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.revise_goal(uuid, text, numeric, date, jsonb) to authenticated;

-- KPI（p_role = kpi）か行動の目標（action）を入れ替える。active な目標だけ。目標がなければ KGI まだの目標を作る（アカウント設計の週の回数）
create function public.set_goal_kpis(p_project_id uuid, p_role text, p_kpis jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_uid) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  if p_role not in ('kpi', 'action') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('goals:' || p_project_id::text));
  v_id := public.ensure_active_goal(p_project_id, v_uid, v_today - (extract(isodow from v_today)::integer - 1));
  perform public.replace_goal_kpis_internal(v_id, v_uid, p_role, p_kpis);
  return v_id;
end;
$$;

revoke all on function public.set_goal_kpis(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_goal_kpis(uuid, text, jsonb) to authenticated;

-- 次の区切り（4 週）を始める（毎月の振り返り・「次の 1 か月を始める」）。今週の月曜から。
-- 終わった区切りは結果を数えて入れ、途中で始め直したときは、いまの区切りを先週の日曜で終える。p_target は次の区切りの目標（KGI まだなら null）
create function public.start_milestone(p_project_id uuid, p_target numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_monday date := v_today - (extract(isodow from v_today)::integer - 1);
  g public.goals;
  v_seq integer;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_uid) then
    raise exception 'project not found' using errcode = '42501';
  end if;
  if p_target is not null and (p_target <= 0 or p_target > 10000000) then
    raise exception 'invalid target' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('goals:' || p_project_id::text));
  select * into g from public.goals where id = public.ensure_active_goal(p_project_id, v_uid, v_monday);
  -- 今週より後に始まる区切り（KGI を決めたときに作った先の区切り）は、今週から並べ直すので消す
  delete from public.goal_milestones m where m.goal_id = g.id and m.starts_on >= v_monday;
  update public.goal_milestones m
     set ends_on = least(m.ends_on, v_monday - 1),
         result_value = case when g.metric is null then null else coalesce((select t.value from public.goal_metric_total(g.project_id, g.metric, g.action, g.sns, m.starts_on, least(m.ends_on, v_monday - 1)) t), 0) end,
         settled_at = now()
   where m.goal_id = g.id and m.settled_at is null;
  select coalesce(max(m.seq), 0) + 1 into v_seq from public.goal_milestones m where m.goal_id = g.id;
  insert into public.goal_milestones (goal_id, owner_id, seq, starts_on, ends_on, target)
  values (g.id, v_uid, v_seq, v_monday, case when g.ends_on is null then v_monday + 27 else least(v_monday + 27, greatest(g.ends_on, v_monday)) end, p_target)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.start_milestone(uuid, numeric) from public, anon, authenticated, service_role;
grant execute on function public.start_milestone(uuid, numeric) to authenticated;

-- 目標を終える（AI なしで「この目標を終える」）。結果を数えて閉じ、行動の目標を引き継いだ KGI まだの目標を始める
create function public.settle_goal(p_goal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project uuid;
begin
  select g.project_id into v_project from public.goals g where g.id = p_goal_id and g.owner_id = v_uid and g.status = 'active';
  if v_project is null then
    raise exception 'goal not found' using errcode = '42501';
  end if;
  return public.start_goal(v_project, null, null, null, null, 'manual');
end;
$$;

revoke all on function public.settle_goal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.settle_goal(uuid) to authenticated;

-- 前のデータ（jsonb の文字列）を、ありえる日付・数のときだけ読む（形の合わない値は null。写し替えと橋渡しを落とさない。2026-11-06 のセキュリティ確認の M1）
create function public.legacy_date(p text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case when p ~ '^\d{4}-\d{2}-\d{2}$' and pg_catalog.pg_input_is_valid(p, 'date') then p::date end;
$$;

create function public.legacy_number(p text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p ~ '^\d{1,9}(\.\d{1,6})?$' then p::numeric end;
$$;

revoke all on function public.legacy_date(text) from public, anon, authenticated, service_role;
revoke all on function public.legacy_number(text) from public, anon, authenticated, service_role;

-- ===== 前の作り（roadmaps と first_month）→ goals（写し替えと橋渡しで同じものを使う。段階 ④ で消す） =====
-- そのプロジェクトの roadmaps と account_plans の first_month を読み、active な goal に写す（なければ作る）。
-- - KGI: roadmaps.kgi が形の合うものなら、その文・数字・目標・期限（数え始めは started_on）。前の作りは上書きの考え方なので、新しい目標は始めずに同じ行を書き換える
-- - KPI: kpi_targets の posts 以外（outcomes は action がないので写さない）
-- - 行動の目標: first_month.weekly があればそれ（伴走が読んでいるものを正とする）。なければ kpi_targets の posts
-- - 区切り: first_month.startedOn（月曜）が、まだ区切りになっていなければ足す（前の区切りはその前の日で終える）
-- 何も写すものがないプロジェクトには goal を作らない
create function public.sync_goal_from_legacy(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.roadmaps;
  v_owner uuid;
  v_fm jsonb;
  v_weekly jsonb;
  v_started date;
  v_kgi_ok boolean := false;
  v_id uuid;
  v_seq integer;
begin
  select p.owner_id into v_owner from public.projects p where p.id = p_project_id;
  if v_owner is null then
    return null;
  end if;
  select * into r from public.roadmaps where project_id = p_project_id;
  select a.data -> 'first_month' into v_fm from public.account_plans a where a.project_id = p_project_id;
  v_weekly := case when jsonb_typeof(v_fm -> 'weekly') = 'object' and v_fm -> 'weekly' <> '{}'::jsonb then v_fm -> 'weekly' end;
  -- 日付は形だけでなく、ありえる日か（2026-02-30 などは写さない）。合わない値で写し替え全体を落とさない
  v_started := public.legacy_date(v_fm ->> 'startedOn');
  if v_started is not null and extract(isodow from v_started) <> 1 then
    v_started := null;
  end if;
  if r.project_id is null and v_weekly is null and not exists (select 1 from public.roadmap_items i where i.project_id = p_project_id) then
    return null;
  end if;

  v_id := public.ensure_active_goal(p_project_id, v_owner, coalesce(r.started_on, v_started, (select min(i.week_start) from public.roadmap_items i where i.project_id = p_project_id)));

  if r.project_id is not null then
    v_kgi_ok := r.kgi is not null and jsonb_typeof(r.kgi) = 'object'
      and coalesce(r.kgi ->> 'kpi', '') in ('posts', 'link_clicks', 'downloads', 'store_page_views', 'revenue', 'followers', 'views')
      and coalesce(public.legacy_number(r.kgi ->> 'target') between 0.000001 and 10000000, false)
      and coalesce(public.legacy_date(r.kgi ->> 'deadline') > r.started_on, false);
    if v_kgi_ok then
      update public.goals
         set statement = left(coalesce(nullif(r.kgi ->> 'statement', ''), '目標'), 120),
             metric = r.kgi ->> 'kpi',
             action = null,
             sns = case when r.kgi ->> 'kpi' = 'posts' and pg_catalog.pg_input_is_valid(r.kgi ->> 'sns', 'public.sns_key') then (r.kgi ->> 'sns')::public.sns_key end,
             target = public.legacy_number(r.kgi ->> 'target'),
             starts_on = r.started_on,
             ends_on = least(public.legacy_date(r.kgi ->> 'deadline'), r.started_on + 371),
             source = r.source
       where id = v_id;
    end if;
    delete from public.goal_kpis where goal_id = v_id and role = 'kpi';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'kpi', t.value ->> 'kpi',
           case when t.value ->> 'kpi' in ('followers', 'views') and pg_catalog.pg_input_is_valid(t.value ->> 'sns', 'public.sns_key') then (t.value ->> 'sns')::public.sns_key end,
           public.legacy_number(t.value ->> 'per_week'), (t.ordinality - 1)::integer
      from jsonb_array_elements(case when jsonb_typeof(r.kpi_targets) = 'array' then r.kpi_targets else '[]'::jsonb end) with ordinality t
     where t.value ->> 'kpi' in ('link_clicks', 'downloads', 'store_page_views', 'revenue', 'followers', 'views')
       and coalesce(public.legacy_number(t.value ->> 'per_week') > 0, false)
    on conflict do nothing;
  end if;

  if v_weekly is not null then
    delete from public.goal_kpis where goal_id = v_id and role = 'action';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'action', 'posts', w.key::public.sns_key, least(14, greatest(1, round(public.legacy_number(w.value::text)))), (w.ordinality - 1)::integer
      from jsonb_each(v_weekly) with ordinality w
     where pg_catalog.pg_input_is_valid(w.key, 'public.sns_key')
       and coalesce(public.legacy_number(w.value::text) >= 1, false);
  elsif r.project_id is not null then
    delete from public.goal_kpis where goal_id = v_id and role = 'action';
    insert into public.goal_kpis (goal_id, owner_id, role, metric, sns, per_week, position)
    select v_id, v_owner, 'action', 'posts', case when pg_catalog.pg_input_is_valid(t.value ->> 'sns', 'public.sns_key') then (t.value ->> 'sns')::public.sns_key end,
           least(14, greatest(1, round(public.legacy_number(t.value ->> 'per_week')))), (t.ordinality - 1)::integer
      from jsonb_array_elements(case when jsonb_typeof(r.kpi_targets) = 'array' then r.kpi_targets else '[]'::jsonb end) with ordinality t
     where t.value ->> 'kpi' = 'posts'
       and coalesce(public.legacy_number(t.value ->> 'per_week') > 0, false)
    on conflict do nothing;
  end if;

  if v_started is not null and not exists (select 1 from public.goal_milestones m where m.goal_id = v_id and m.starts_on = v_started) then
    delete from public.goal_milestones m where m.goal_id = v_id and m.starts_on > v_started;
    update public.goal_milestones m set ends_on = v_started - 1
     where m.goal_id = v_id and m.starts_on < v_started and m.ends_on >= v_started;
    select coalesce(max(m.seq), 0) + 1 into v_seq from public.goal_milestones m where m.goal_id = v_id;
    insert into public.goal_milestones (goal_id, owner_id, seq, starts_on, ends_on)
    values (v_id, v_owner, v_seq, v_started, v_started + 27);
  end if;
  return v_id;
end;
$$;

revoke all on function public.sync_goal_from_legacy(uuid) from public, anon, authenticated, service_role;
-- サーバーだけ（写し替えを 1 つのプロジェクトに流して確かめる結合テストと、運営の手当てに使う）
grant execute on function public.sync_goal_from_legacy(uuid) to service_role;

-- 橋渡し: 前のコードが roadmaps か account_plans に書いたら、goals に写す
create function public.legacy_bridge_to_goals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_goal_from_legacy(new.project_id);
  return new;
end;
$$;

revoke all on function public.legacy_bridge_to_goals() from public, anon, authenticated, service_role;

create trigger roadmaps_bridge_to_goals after insert or update of kgi, kpi_targets, started_on on public.roadmaps
  for each row execute function public.legacy_bridge_to_goals();
create trigger account_plans_bridge_to_goals after insert or update of data on public.account_plans
  for each row
  when (new.data -> 'first_month' is not null)
  execute function public.legacy_bridge_to_goals();

-- ===== 今のデータを写す（roadmaps と account_plans は変えない） =====
select public.sync_goal_from_legacy(p.id)
  from public.projects p
 where exists (select 1 from public.roadmaps r where r.project_id = p.id)
    or exists (select 1 from public.account_plans a where a.project_id = p.id and jsonb_typeof(a.data -> 'first_month' -> 'weekly') = 'object' and a.data -> 'first_month' -> 'weekly' <> '{}'::jsonb)
    or exists (select 1 from public.roadmap_items i where i.project_id = p.id);

-- 6. やることを、そのプロジェクトの goal につなぐ
update public.roadmap_items i
   set goal_id = g.id
  from public.goals g
 where g.project_id = i.project_id and g.status = 'active' and i.goal_id is null;

-- 7. 確かめる（合わなければ全体を戻す）
do $$
declare
  v_roadmaps integer;
  v_goals integer;
  v_orphans integer;
begin
  select count(*) into v_roadmaps from public.roadmaps;
  select count(*) into v_goals from public.goals g where exists (select 1 from public.roadmaps r where r.project_id = g.project_id);
  select count(*) into v_orphans from public.roadmap_items where goal_id is null;
  if v_roadmaps <> v_goals or v_orphans <> 0 then
    raise exception 'goals backfill mismatch: roadmaps % goals % orphan items %', v_roadmaps, v_goals, v_orphans;
  end if;
end;
$$;

-- 写し終えてから、やることのトリガーを付ける（写すときの update で動かさない）
create trigger roadmap_items_check_goal before insert or update of goal_id, project_id on public.roadmap_items
  for each row execute function public.roadmap_items_check_goal();

-- ===== 「いまやること」の判定（ロードマップがあるか）を goals から読む =====
create or replace function public.project_step_flags(p_project_id uuid, p_week_start date)
returns table (project_id uuid, has_published boolean, has_roadmap boolean, this_week_todo bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with open_items as (
    select i.id, i.project_id, i.kpi, i.target
      from public.roadmap_items i
     where (p_project_id is null or i.project_id = p_project_id)
       and i.week_start = p_week_start
       and i.status = 'todo'
  ),
  post_progress as (
    select pr.item_id, pr.published
      from (select distinct o.project_id from open_items o where o.kpi = 'posts') x
     cross join lateral public.roadmap_item_progress(x.project_id, p_week_start, p_week_start) pr
  ),
  click_totals as (
    select x.project_id, coalesce(sum(d.link_clicks), 0) as clicks
      from (select distinct o.project_id from open_items o where o.kpi = 'link_clicks') x
     cross join lateral public.roadmap_daily_totals(x.project_id, p_week_start, p_week_start + 6) d
     group by x.project_id
  ),
  still_open as (
    select o.project_id
      from open_items o
      left join post_progress pp on pp.item_id = o.id
      left join click_totals ct on ct.project_id = o.project_id
     where not (
       o.target is not null
       and ((o.kpi = 'posts' and coalesce(pp.published, 0) >= o.target)
         or (o.kpi = 'link_clicks' and coalesce(ct.clicks, 0) >= o.target))
     )
  )
  select p.id,
         exists (
           select 1
             from public.posts po
             join public.post_targets t on t.post_id = po.id
            where po.project_id = p.id
              and t.status = 'published'
         ),
         exists (select 1 from public.goals g where g.project_id = p.id and g.metric is not null)
           or exists (select 1 from public.roadmap_items i where i.project_id = p.id),
         (select count(*) from still_open s where s.project_id = p.id)
    from public.projects p
   where p_project_id is null or p.id = p_project_id
$$;

revoke execute on function public.project_step_flags(uuid, date) from public, anon, authenticated;
grant execute on function public.project_step_flags(uuid, date) to authenticated;
