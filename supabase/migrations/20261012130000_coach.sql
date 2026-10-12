-- 伴走（F18、決定 D29。docs/architecture.md の 4.27）: 最初の 1 か月の SNS ごとの週の回数を見張り、画面・メール・スマホの通知で声をかける。
-- ペースの数え方は counted_post_targets（20261012120000）。ここでは、通知の設定・送った記録・週ごとの結果を持つ

-- ===== 通知の設定（利用者ごと） =====
-- 行がない利用者は既定（メールもスマホも「毎週の振り返り＋遅れそうなとき」、遅れの声かけは水曜）
create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- weekly_and_behind: 毎週の振り返り＋遅れそうなとき / weekly: 毎週の振り返りだけ / off: 送らない
  email_mode text not null default 'weekly_and_behind' check (email_mode in ('weekly_and_behind', 'weekly', 'off')),
  push_mode text not null default 'weekly_and_behind' check (push_mode in ('weekly_and_behind', 'weekly', 'off')),
  -- 遅れそうなときの声かけをする曜日（1 = 月曜 … 5 = 金曜）。その曜日の朝に、今週まだ 1 本もない SNS があれば送る
  behind_weekday smallint not null default 3 check (behind_weekday between 1 and 5),
  -- メールの「配信を止める」のリンクの合言葉（ログインしなくても、ワンクリックで止められるように）
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);

comment on table public.notification_prefs is '伴走の通知の設定（4.27）。行がなければ既定';

create trigger notification_prefs_set_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();

alter table public.notification_prefs enable row level security;

create policy "notification_prefs_select_own" on public.notification_prefs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "notification_prefs_insert_own" on public.notification_prefs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "notification_prefs_update_own" on public.notification_prefs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 本人が変えられるのは設定の 3 つだけ（合言葉は変えさせない。配信の停止はサーバーが合言葉で行う）
revoke all on table public.notification_prefs from anon, authenticated;
grant select on public.notification_prefs to authenticated;
grant insert (user_id, email_mode, push_mode, behind_weekday) on public.notification_prefs to authenticated;
grant update (email_mode, push_mode, behind_weekday) on public.notification_prefs to authenticated;
grant all on table public.notification_prefs to service_role;

-- ===== 送った記録（同じ知らせを二重に送らない） =====
-- kind: behind（遅れそう）/ weekly（月曜の振り返り）。period_key: その週の月曜（YYYY-MM-DD）。channel: email / push
create table public.notification_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('behind', 'weekly')),
  period_key text not null check (char_length(period_key) between 1 and 40),
  channel text not null check (channel in ('email', 'push')),
  created_at timestamptz not null default now(),
  unique (user_id, project_id, kind, period_key, channel)
);

comment on table public.notification_log is '伴走の知らせを送った記録（4.27）。二重に送らないため。90 日で消す';

create index notification_log_created_idx on public.notification_log (created_at);

-- サーバー（service_role）だけが扱う
alter table public.notification_log enable row level security;
revoke all on table public.notification_log from anon, authenticated;
grant all on table public.notification_log to service_role;

-- ===== 週ごとの結果（続けた週を数えるため。その週の目標と、送った数） =====
create table public.pace_weeks (
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- その週の月曜（日本時間）
  week_start date not null check (extract(isodow from week_start) = 1),
  -- { "x": 2, "instagram": 1 }（その週の目標）
  targets jsonb not null check (jsonb_typeof(targets) = 'object' and pg_column_size(targets) <= 2048),
  -- { "x": 2 }（送信済み）と { "instagram": 1 }（予約済み。終わった週は 0）
  published jsonb not null default '{}'::jsonb check (jsonb_typeof(published) = 'object' and pg_column_size(published) <= 2048),
  scheduled jsonb not null default '{}'::jsonb check (jsonb_typeof(scheduled) = 'object' and pg_column_size(scheduled) <= 2048),
  -- すべての SNS で目標に届いたか（送信済みで数える）
  achieved boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (project_id, week_start)
);

comment on table public.pace_weeks is '伴走の週ごとの結果（4.27）。毎日のジョブが書く。続けた週の数に使う';

create trigger pace_weeks_set_updated_at
  before update on public.pace_weeks
  for each row execute function public.set_updated_at();

alter table public.pace_weeks enable row level security;

create policy "pace_weeks_select_own" on public.pace_weeks
  for select to authenticated using ((select auth.uid()) = owner_id);

-- 本人は読むだけ。書くのはサーバー（毎日のジョブ）
revoke all on table public.pace_weeks from anon, authenticated;
grant select on public.pace_weeks to authenticated;
grant all on table public.pace_weeks to service_role;

-- ===== 毎日のジョブ（日本時間 7:00 = UTC 22:00）と、古い記録の片付け =====
select cron.schedule('yabumi-coach', '0 22 * * *', $$select public.invoke_job('/api/jobs/coach')$$);
-- 送った記録は 90 日、週ごとの結果は 400 日（1 年あまり。続けた週の数と 1 か月の振り返りには足りる）
select cron.schedule(
  'yabumi-purge-coach',
  '40 18 * * *',
  $$delete from public.notification_log where created_at < now() - interval '90 days';
    delete from public.pace_weeks where week_start < (now() at time zone 'Asia/Tokyo')::date - 400$$
);
