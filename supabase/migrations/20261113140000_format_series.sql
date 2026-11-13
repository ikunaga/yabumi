-- シリーズ投稿（フォーマットの一部を AI が毎回埋める。docs/design/format-series.md、2026-11-13 PM の了承）。
-- ① post_formats.series: AI が埋める穴の指示と、本文に出さない「答え」の名前と指示
-- ② post_format_rounds: シリーズの記録（回ごとの答えと穴の言葉）。前の回と重ならない案を出すために使う
-- ③ reserve_ai_usage に用途 post_format_round（次の回の案。1 人 1 日 20 回）
-- 新しく預かる情報と、Anthropic に送る新しい中身があるので、プライバシーポリシーの ②（docs/legal.md）。オーナーの了承まで本番に出さない

-- ===== ① フォーマットの AI の穴 =====
-- {"answer": {"name": "映画", "instruction": "…"} | null, "slots": {"キーワード": "…"}}。名前 12 字・指示 60 字まで、AI の穴は 8 つまで
-- （型の文にない穴の指示を捨てるのはアプリ。src/lib/post-formats/series.ts）
alter table public.post_formats add column series jsonb not null default '{}'::jsonb
  check (
    jsonb_typeof(series) = 'object'
    and (series - array['answer', 'slots']::text[]) = '{}'::jsonb
    -- 「?」の演算子は文字の型があいまいになるので使わない（-> が null かで、キーがないことを見る）
    and (coalesce(jsonb_typeof(series->'answer'), 'null') = 'null' or (
      jsonb_typeof(series->'answer') = 'object'
      and ((series->'answer') - array['name', 'instruction']::text[]) = '{}'::jsonb
      -- キーがないと jsonb_typeof は null になり、check は null を通してしまうので coalesce で false にする
      and coalesce(jsonb_typeof(series->'answer'->'name'), '') = 'string'
      and coalesce(jsonb_typeof(series->'answer'->'instruction'), '') = 'string'
      and char_length(series->'answer'->>'name') between 1 and 12
      and char_length(series->'answer'->>'instruction') <= 60
    ))
    and (series->'slots' is null or (
      jsonb_typeof(series->'slots') = 'object'
      -- 指示は文字列で 60 字まで、穴の名前は 1〜12 字、8 つまで（check では副問い合わせを使えないので jsonpath で数える）
      and not jsonb_path_exists(series, 'strict $.slots.* ? (@.type() != "string" || !(@ like_regex "^.{0,60}$" flag "s"))', '{}', true)
      and not jsonb_path_exists(series, 'strict $.slots.keyvalue() ? (!(@.key like_regex "^.{1,12}$" flag "s"))', '{}', true)
      and jsonb_array_length(jsonb_path_query_array(series, 'strict $.slots.keyvalue()', '{}', true)) <= 8
    ))
    and octet_length(series::text) <= 4000
  );

comment on column public.post_formats.series is 'シリーズ投稿の設定。answer: 本文に出さない答え（名前と AI への指示）、slots: AI が埋める穴の名前と指示';

grant insert (series) on public.post_formats to authenticated;
grant update (series) on public.post_formats to authenticated;

-- ===== ② シリーズの記録 =====
create table public.post_format_rounds (
  id uuid primary key default gen_random_uuid(),
  format_id uuid not null references public.post_formats (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 結びついた投稿（保存したとき）。投稿を消しても記録は残す（もう出した回として扱う）
  post_id uuid references public.posts (id) on delete set null,
  answer text not null default '' check (char_length(answer) <= 100),
  -- 穴の名前 → 言葉（16 個まで・1 つ 200 字まで。形はアプリでそろえ、ここは大きさだけを縛る）
  "values" jsonb not null default '{}'::jsonb check (jsonb_typeof("values") = 'object' and octet_length("values"::text) <= 8000),
  -- ai: AI の案を使った / pasted: これまでの回を貼った / hand: 自分で埋めて本文に入れた
  source text not null check (source in ('ai', 'pasted', 'hand')),
  created_at timestamptz not null default now(),
  check (char_length(btrim(answer)) > 0 or "values" <> '{}'::jsonb)
);

comment on table public.post_format_rounds is 'シリーズの記録（フォーマットの回ごとの答えと穴の言葉。1 つのフォーマットに 300 回まで、1 人 3,000 回まで）';

create index post_format_rounds_format_idx on public.post_format_rounds (format_id, created_at desc);
create index post_format_rounds_owner_idx on public.post_format_rounds (owner_id);
create index post_format_rounds_post_idx on public.post_format_rounds (post_id) where post_id is not null;

-- 1 つのフォーマットに 300 回まで、1 人の合計で 3,000 回まで（PM の確認。フォーマット 100 個 × 300 回で 3 万行まで増やせないように）。
-- 同時に足されても超えないよう、数える前にフォーマットの行を押さえ、利用者ごとの advisory lock を取る（post_formats_limit と同じ作り）。
-- security invoker なので、押さえられるのは本人が更新できる自分のフォーマットだけ
create function public.post_format_rounds_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.post_formats where id = new.format_id for update;
  if (select count(*) from public.post_format_rounds r where r.format_id = new.format_id) >= 300 then
    raise exception 'シリーズの記録は 1 つのフォーマットに 300 回までです' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('post_format_rounds:' || new.owner_id::text));
  if (select count(*) from public.post_format_rounds r where r.owner_id = new.owner_id) >= 3000 then
    raise exception 'シリーズの記録は 1 人 3,000 回までです' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.post_format_rounds_limit() from public, anon, authenticated;

create trigger post_format_rounds_limit
  before insert on public.post_format_rounds
  for each row execute function public.post_format_rounds_limit();

alter table public.post_format_rounds enable row level security;

create policy "post_format_rounds_select_own" on public.post_format_rounds
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "post_format_rounds_insert_own" on public.post_format_rounds
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and post_id is null
    and exists (select 1 from public.post_formats f where f.id = format_id and f.owner_id = (select auth.uid()))
  );
-- 投稿に結びつけるだけ。結びつける先は自分の投稿で、まだ結びついていない記録だけ（一度結びつけたら、別の投稿へ付け替えない。
-- 投稿を消すと空に戻るので、そのときはまた結びつけられる）
create policy "post_format_rounds_update_own" on public.post_format_rounds
  for update to authenticated using ((select auth.uid()) = owner_id and post_id is null)
  with check (
    (select auth.uid()) = owner_id
    and (post_id is null or exists (select 1 from public.posts p where p.id = post_id and p.owner_id = (select auth.uid())))
  );
create policy "post_format_rounds_delete_own" on public.post_format_rounds
  for delete to authenticated using ((select auth.uid()) = owner_id);

grant select, delete on public.post_format_rounds to authenticated;
grant insert (format_id, owner_id, answer, "values", source) on public.post_format_rounds to authenticated;
grant update (post_id) on public.post_format_rounds to authenticated;

-- ===== ③ 次の回の案の AI =====
-- 20261110130000_post_format_ai の定義の写しに、用途 post_format_round の下限と、1 人 1 日 20 回の判定を足す。revoke・grant は前と同じ
create or replace function public.reserve_ai_usage(
  p_owner_id uuid,
  p_purpose text,
  p_cost_usd numeric,
  p_thread_id uuid default null,
  p_scope_owner uuid default null,
  p_as_of timestamptz default null
)
returns table (usage_id uuid, status text, global_month_usd numeric, new_until date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_user_monthly_usd constant numeric := 3;
  c_global_monthly_usd constant numeric := 10;
  c_user_daily_turns constant integer := 60;
  c_voice_memo_daily_runs constant integer := 3;
  c_post_format_daily_runs constant integer := 10;
  c_post_format_round_daily_runs constant integer := 20;
  c_new_days constant interval := interval '7 days';
  -- 1 回の呼び出しで予約できる見込みの上限（src/lib/ai/budget.ts の AI_MAX_RESERVATION_USD と同じ値）
  c_max_reservation_usd constant numeric := 1;
  v_floor numeric;
  v_cost numeric;
  v_now timestamptz := now();
  v_month_start timestamptz := date_trunc('month', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_day_start timestamptz := date_trunc('day', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_created timestamptz;
  v_new boolean;
  v_new_until date;
  v_global numeric;
  v_new_global numeric;
  v_user numeric;
  v_today integer;
  v_id uuid;
begin
  -- 用途ごとの見込みの下限（米ドル）。その用途で使う呼び出しのうち、出力の上限がいちばん小さいものの最大の額
  -- （送る中身が空でも、足される分 8,000 トークン × $6.25 と出力の上限 × $25 / 100 万トークン。src/lib/ai/budget.ts の reserveEstimateUsd と同じ数え方。
  -- tests/ai-budget.test.ts で、アプリの見込みがこれを下回らないことを確かめる）。知らない用途は断る
  v_floor := case p_purpose
    when 'account_plan' then 0.25     -- 設計の相棒（出力 8,000）
    when 'consult' then 0.15          -- 相談（8,000）と縮める（4,000）
    when 'app_description' then 0.10  -- 読むファイルを選ぶ（2,000）と紹介文（4,000）
    when 'post_ideas' then 0.15       -- ネタ（16,000）と縮める（4,000）
    when 'ai_check' then 0.15         -- AI っぽさチェック（4,000）
    when 'image_brief' then 0.15      -- 画像の文字の案（4,000）
    when 'image_photo_idea' then 0.15 -- 写真・絵の場面の案（4,000）
    when 'tidy_draft' then 0.15       -- 投稿に整える（8,000）と縮める（4,000）
    when 'voice_memo' then 0.15       -- 書き方（文調のメモ）を読み取る（4,000）
    when 'post_format' then 0.12      -- 投稿のフォーマットの案を AI とつくる（3,000）
    when 'post_format_round' then 0.11 -- シリーズの次の回の案（2,500）
  end;
  if p_owner_id is null or v_floor is null or p_cost_usd is null or p_cost_usd <= 0 or p_cost_usd > c_max_reservation_usd then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  -- 渡された見込みが下限より小さければ、下限で予約する
  v_cost := greatest(p_cost_usd, v_floor);
  select u.created_at into v_created from auth.users u where u.id = p_owner_id;
  if v_created is null then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  v_new := v_created + c_new_days > coalesce(p_as_of, v_now);
  v_new_until := ((v_created + c_new_days) at time zone 'Asia/Tokyo')::date;

  perform pg_advisory_xact_lock(hashtext('ai_usage'));
  select coalesce(sum(a.cost_usd), 0) into v_global
    from public.ai_usage a
   where a.created_at >= v_month_start
     and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
  select coalesce(sum(a.cost_usd) filter (where a.created_at >= v_month_start), 0),
         (count(*) filter (where a.created_at >= v_day_start))::integer
    into v_user, v_today
    from public.ai_usage a
   where a.owner_id = p_owner_id
     and a.created_at >= least(v_month_start, v_day_start);

  if v_global + v_cost > c_global_monthly_usd then
    return query select null::uuid, 'global_limit'::text, v_global, null::date;
    return;
  end if;
  if v_new then
    -- 今月、新しい人のときに予約した行（退会しても残る）
    select coalesce(sum(a.cost_usd), 0) into v_new_global
      from public.ai_usage a
     where a.created_at >= v_month_start
       and a.by_new_user
       and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
    if v_new_global + v_cost > c_global_monthly_usd / 3 then
      return query select null::uuid, 'new_global_limit'::text, v_global, v_new_until;
      return;
    end if;
    if v_user + v_cost > c_user_monthly_usd / 3 then
      return query select null::uuid, 'new_user_limit'::text, v_global, v_new_until;
      return;
    end if;
  elsif v_user + v_cost > c_user_monthly_usd then
    return query select null::uuid, 'user_limit'::text, v_global, null::date;
    return;
  end if;
  if v_today >= c_user_daily_turns then
    return query select null::uuid, 'daily_limit'::text, v_global, null::date;
    return;
  end if;
  -- 書き方の読み取り（voice_memo）は 1 人 1 日 3 回まで。予約と同じ lock の中で数えるので、同時に押しても超えない
  -- （利用者が消せない ai_usage で数える。src/lib/plan/voice-rules.ts の VOICE_MEMO_DAILY_RUNS と同じ値）
  if p_purpose = 'voice_memo' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'voice_memo' and a.created_at >= v_day_start
  ) >= c_voice_memo_daily_runs then
    return query select null::uuid, 'voice_memo_limit'::text, v_global, null::date;
    return;
  end if;
  -- 投稿のフォーマットを AI とつくる（post_format）は 1 人 1 日 10 回まで（voice_memo と同じ数え方。src/lib/post-formats/schema.ts の POST_FORMAT_DAILY_RUNS と同じ値）
  if p_purpose = 'post_format' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'post_format' and a.created_at >= v_day_start
  ) >= c_post_format_daily_runs then
    return query select null::uuid, 'post_format_limit'::text, v_global, null::date;
    return;
  end if;
  -- シリーズの次の回の案（post_format_round）は 1 人 1 日 20 回まで（同じ数え方。src/lib/post-formats/series.ts の SERIES_DAILY_RUNS と同じ値）
  if p_purpose = 'post_format_round' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'post_format_round' and a.created_at >= v_day_start
  ) >= c_post_format_round_daily_runs then
    return query select null::uuid, 'post_format_round_limit'::text, v_global, null::date;
    return;
  end if;

  insert into public.ai_usage (owner_id, thread_id, purpose, model, cost_usd, status, by_new_user)
  values (p_owner_id, p_thread_id, p_purpose, 'reserved', v_cost, 'reserved', v_new)
  returning id into v_id;
  return query select v_id, 'ok'::text, v_global + v_cost, case when v_new then v_new_until end;
end;
$$;

comment on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) is '文章の AI を呼ぶ前に、上限（関数の中で固定）を確かめて見込みの費用で予約する。見込みは用途ごとの下限と 1 回の上限（$1）で挟む。断った分は記録しない';

revoke all on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) to service_role;
