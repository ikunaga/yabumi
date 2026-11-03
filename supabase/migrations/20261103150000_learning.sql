-- 使いながらマーケティングの知識が身につく「今日の用語」と「ひとこと」（docs/architecture.md の 4.47、2026-11-03 オーナーの了承）。
-- 預かるのは「学びの記録」だけ（プライバシーポリシーの ②。docs/legal.md）: 読んだ用語、出したひとこと、今日の用語に出した語と閉じた日、学びの表示のオンとオフ。
-- 書き込みはすべて security definer の関数から（本人は auth.uid()、日時は now() でサーバーが決める）。利用者が直接書けるのは、学びの表示のオンとオフだけ。
-- 行は人ごとに増え続けない（用語 1 つに 1 行・ひとこと 1 つに 1 行の上書き）ので、purge_expired_data には入れず、退会で消す（on delete cascade）

-- ── 読んだ用語（用語集の詳細ページを開いたとき） ──
create table public.learning_term_reads (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  term_key text not null check (term_key ~ '^[A-Za-z0-9_]{1,64}$'),
  first_read_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (user_id, term_key)
);
comment on table public.learning_term_reads is '学びの記録: 用語集で読んだ用語（4.47）。用語 1 つに 1 行。退会で消える';

alter table public.learning_term_reads enable row level security;
create policy "learning_term_reads_select_own" on public.learning_term_reads
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.learning_term_reads from anon, authenticated;
grant select on public.learning_term_reads to authenticated;
grant all on table public.learning_term_reads to service_role;

-- ── 出したひとこと（ひとこと 1 つに 1 行。出すたびに日時を上書き） ──
create table public.learning_tip_shows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tip_key text not null check (tip_key ~ '^[A-Za-z0-9_]{1,64}$'),
  last_shown_at timestamptz not null default now(),
  primary key (user_id, tip_key)
);
comment on table public.learning_tip_shows is '学びの記録: 画面に出したひとこと（4.47）。ひとこと 1 つに 1 行で、最後に出した日時だけ。退会で消える';

alter table public.learning_tip_shows enable row level security;
create policy "learning_tip_shows_select_own" on public.learning_tip_shows
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on table public.learning_tip_shows from anon, authenticated;
grant select on public.learning_tip_shows to authenticated;
grant all on table public.learning_tip_shows to service_role;

-- ── 学びの表示のオンとオフ、今日の用語（お知らせの設定と同じ行） ──
alter table public.notification_prefs
  add column learning_enabled boolean not null default true,
  -- その日に出した「今日の用語」（同じ日は同じ語にする）と、閉じた日（日本時間の日付。その日は出さない）
  add column learning_term_key text check (learning_term_key is null or learning_term_key ~ '^[A-Za-z0-9_]{1,64}$'),
  add column learning_term_on date,
  add column learning_term_dismissed_on date;
comment on column public.notification_prefs.learning_enabled is '学びの表示（今日の用語・ひとこと）を出すか（4.47）。利用者が設定で変える';

-- 利用者が変えられるのは learning_enabled だけ（今日の用語の列は下の関数が書く）
grant insert (learning_enabled) on public.notification_prefs to authenticated;
grant update (learning_enabled) on public.notification_prefs to authenticated;

-- 日本時間の今日
create or replace function public.learning_today_jst()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Tokyo')::date;
$$;
revoke all on function public.learning_today_jst() from public, anon, authenticated, service_role;

-- 用語を読んだ（1 用語 1 行。読み直したら last_read_at だけ）。用語の key が用語集にあるかはアプリのサーバー（src/lib/learning/）が確かめてから呼ぶ。
-- 知らない key を大量に送られても行が増え続けないよう、1 人 64 語までにする（用語集は 32 語）
create or replace function public.record_learning_term_read(p_term_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_term_key is null or p_term_key !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'bad term key' using errcode = '22023';
  end if;
  update public.learning_term_reads set last_read_at = now() where user_id = v_uid and term_key = p_term_key;
  if found then
    return;
  end if;
  if (select count(*) from public.learning_term_reads where user_id = v_uid) >= 64 then
    return;
  end if;
  insert into public.learning_term_reads (user_id, term_key) values (v_uid, p_term_key)
  on conflict (user_id, term_key) do update set last_read_at = now();
end;
$$;
revoke all on function public.record_learning_term_read(text) from public, anon, authenticated, service_role;
grant execute on function public.record_learning_term_read(text) to authenticated;

-- ひとことを 1 つ出してよいかを決め、出すものを記録して返す（出さないときは null）。
-- 学びの表示がオフ、または今日（日本時間）もう 1 つ出したなら出さない。出すのは、候補のうちまだ出していないもの（候補の順）、
-- なければ出したのが古いもの。同じ人の同時の呼び出しは順に並べる（1 日 1 回を越えないように）
create or replace function public.claim_learning_tip(p_candidates text[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today_start timestamptz := (public.learning_today_jst()::timestamp at time zone 'Asia/Tokyo');
  v_pick text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_candidates is null or cardinality(p_candidates) = 0 or cardinality(p_candidates) > 20
     or exists (select 1 from unnest(p_candidates) c where c is null or c !~ '^[A-Za-z0-9_]{1,64}$') then
    raise exception 'bad tip keys' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('learning_tip:' || v_uid::text, 0));
  if exists (select 1 from public.notification_prefs where user_id = v_uid and not learning_enabled) then
    return null;
  end if;
  if exists (select 1 from public.learning_tip_shows where user_id = v_uid and last_shown_at >= v_today_start) then
    return null;
  end if;
  select c.key into v_pick
  from unnest(p_candidates) with ordinality as c(key, ord)
  left join public.learning_tip_shows s on s.user_id = v_uid and s.tip_key = c.key
  order by s.last_shown_at nulls first, c.ord
  limit 1;
  -- まだ出していない種類を足すときは、1 人 64 種類まで（呼び出し側から変な key を送られても行が膨らまないように）
  if not exists (select 1 from public.learning_tip_shows where user_id = v_uid and tip_key = v_pick)
     and (select count(*) from public.learning_tip_shows where user_id = v_uid) >= 64 then
    return null;
  end if;
  insert into public.learning_tip_shows (user_id, tip_key) values (v_uid, v_pick)
  on conflict (user_id, tip_key) do update set last_shown_at = now();
  return v_pick;
end;
$$;
revoke all on function public.claim_learning_tip(text[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_learning_tip(text[]) to authenticated;

-- 今日の用語を決める。語を選ぶのはアプリ（src/lib/learning/today-term.ts の pickTodayTerm。用語集にある key だけを渡す）で、DB は日ごとに覚えるだけ。
-- 今日もう決めていればそれを返し（同じ日は同じ語）、まだなら p_term_key を今日の語として覚えて返す。
-- 学びの表示がオフか、今日閉じていれば null（出さない）
create or replace function public.learning_today_term(p_term_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.learning_today_jst();
  v_row public.notification_prefs;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_term_key is null or p_term_key !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'bad term key' using errcode = '22023';
  end if;
  insert into public.notification_prefs (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_row from public.notification_prefs where user_id = v_uid for update;
  if not v_row.learning_enabled or v_row.learning_term_dismissed_on = v_today then
    return null;
  end if;
  if v_row.learning_term_on = v_today and v_row.learning_term_key is not null then
    return v_row.learning_term_key;
  end if;
  update public.notification_prefs set learning_term_key = p_term_key, learning_term_on = v_today where user_id = v_uid;
  return p_term_key;
end;
$$;
revoke all on function public.learning_today_term(text) from public, anon, authenticated, service_role;
grant execute on function public.learning_today_term(text) to authenticated;

-- 今日の用語を閉じる（その日は出さない。日付はサーバーが決める）
create or replace function public.dismiss_learning_today_term()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.notification_prefs (user_id, learning_term_dismissed_on) values (v_uid, public.learning_today_jst())
  on conflict (user_id) do update set learning_term_dismissed_on = public.learning_today_jst();
end;
$$;
revoke all on function public.dismiss_learning_today_term() from public, anon, authenticated, service_role;
grant execute on function public.dismiss_learning_today_term() to authenticated;
