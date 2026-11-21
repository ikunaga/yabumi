-- AI の枠の状態を、送る前に画面で出す（2026-11-21 オーナーの依頼「今月の AI の使用量を超えたときは、相談の一覧の上のほうに、今月は使えないこと・いつ使えるようになるかを」。PM 了承: 案 A）。
-- 上限の数と数え方を 1 か所（ai_budget_check）にまとめ、予約（reserve_ai_usage）と状態（ai_budget_status）の両方がそれを使う。
-- reserve_ai_usage の数え方は変えない（前の定義 20261119110000 から、用途の下限・合計・判定の順をそのまま ai_budget_check に移した。返す値も同じ）

-- 1. 数える（中だけで使う。だれにも execute を渡さない。予約と状態の security definer の関数から呼ぶ）
create function public.ai_budget_check(p_owner_id uuid, p_purpose text, p_cost_usd numeric, p_scope_owner uuid default null, p_as_of timestamptz default null)
returns table (status text, global_month_usd numeric, new_until date, by_new_user boolean, cost_usd numeric, user_cap_usd numeric, user_month_usd numeric)
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
  -- 自動の投稿の枠（docs/design/auto-post.md の A4。2026-11-16 オーナーが (a) に決めた）。ふだんの枠（上の 3 つ）とは別に数える
  c_auto_user_monthly_usd constant numeric := 3;
  c_auto_global_monthly_usd constant numeric := 5;
  c_auto_user_daily_runs constant integer := 10;
  -- 見本を作る（auto_post_sample）は 1 人 1 日 5 回まで。ジョブの回の 10 回とは別に数える（docs/design/auto-sample-image.md の 1.4）
  c_auto_sample_daily_runs constant integer := 5;
  c_new_days constant interval := interval '7 days';
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
  v_auto boolean := p_purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene');
  v_auto_today integer;
  -- この用途の枠（自動の投稿か、ふだんか）
  v_user_cap numeric := case when v_auto then c_auto_user_monthly_usd else c_user_monthly_usd end;
  v_global_cap numeric := case when v_auto then c_auto_global_monthly_usd else c_global_monthly_usd end;
  -- この人のいまの月の枠（登録して 7 日までは 1/3）
  v_cap numeric;
begin
  -- 用途ごとの見込みの下限（米ドル）。その用途で使う呼び出しのうち、出力の上限がいちばん小さいものの最大の額
  -- （src/lib/ai/budget.ts の reserveEstimateUsd と同じ数え方。tests/ai-budget.test.ts で確かめる）。知らない用途は断る
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
    when 'auto_post' then 0.13        -- 自動の投稿の文を作る（3,200）・縮める・直す
    when 'auto_post_check' then 0.15  -- 自動の回の AI っぽさチェック（4,000。ai_check と同じ）
    when 'auto_post_sample' then 0.13 -- 見本を作る（auto_post と同じ呼び出し。3,200）・縮める
    when 'auto_post_scene' then 0.15  -- 自動の回の画像の場面（写真・絵の場面の案と同じ呼び出し。4,000）
  end;
  if p_owner_id is null or v_floor is null or p_cost_usd is null or p_cost_usd < 0 then
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
  v_cap := case when v_new then v_user_cap / 3 else v_user_cap end;

  -- ふだんの用途と自動の投稿の用途は、別々の枠で数える（v_auto の側だけを合計する）
  select coalesce(sum(a.cost_usd), 0) into v_global
    from public.ai_usage a
   where a.created_at >= v_month_start
     and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene')) = v_auto
     and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
  select coalesce(sum(a.cost_usd) filter (where a.created_at >= v_month_start), 0),
         (count(*) filter (where a.created_at >= v_day_start))::integer,
         (count(*) filter (where a.created_at >= v_day_start and a.purpose = 'auto_post'))::integer
    into v_user, v_today, v_auto_today
    from public.ai_usage a
   where a.owner_id = p_owner_id
     and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene')) = v_auto
     and a.created_at >= least(v_month_start, v_day_start);

  if v_global + v_cost > v_global_cap then
    return query select 'global_limit'::text, v_global, null::date, v_new, v_cost, v_cap, v_user;
    return;
  end if;
  if v_new then
    -- 今月、新しい人のときに予約した行（退会しても残る）
    select coalesce(sum(a.cost_usd), 0) into v_new_global
      from public.ai_usage a
     where a.created_at >= v_month_start
       and a.by_new_user
       and (a.purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene')) = v_auto
       and (p_scope_owner is null or a.owner_id in (p_scope_owner, p_owner_id));
    if v_new_global + v_cost > v_global_cap / 3 then
      return query select 'new_global_limit'::text, v_global, v_new_until, v_new, v_cost, v_cap, v_user;
      return;
    end if;
    if v_user + v_cost > v_user_cap / 3 then
      return query select 'new_user_limit'::text, v_global, v_new_until, v_new, v_cost, v_cap, v_user;
      return;
    end if;
  elsif v_user + v_cost > v_user_cap then
    return query select 'user_limit'::text, v_global, null::date, v_new, v_cost, v_cap, v_user;
    return;
  end if;
  -- 1 日の回数: ふだんは往復 60 回、自動の投稿は作る（auto_post）回数で 10 回（チェックは数えない。作った回ごとに 1〜2 回なので）
  if (not v_auto and v_today >= c_user_daily_turns) or (p_purpose = 'auto_post' and v_auto_today >= c_auto_user_daily_runs) then
    return query select 'daily_limit'::text, v_global, null::date, v_new, v_cost, v_cap, v_user;
    return;
  end if;
  -- 見本を作る（auto_post_sample）は 1 人 1 日 5 回まで（同じ lock の中で数える。src/lib/auto-post/schema.ts の AUTO_SAMPLE_DAILY_RUNS と同じ値）
  if p_purpose = 'auto_post_sample' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'auto_post_sample' and a.created_at >= v_day_start
  ) >= c_auto_sample_daily_runs then
    return query select 'auto_sample_limit'::text, v_global, null::date, v_new, v_cost, v_cap, v_user;
    return;
  end if;
  -- 書き方の読み取り（voice_memo）は 1 人 1 日 3 回まで。予約と同じ lock の中で数えるので、同時に押しても超えない
  -- （利用者が消せない ai_usage で数える。src/lib/plan/voice-rules.ts の VOICE_MEMO_DAILY_RUNS と同じ値）
  if p_purpose = 'voice_memo' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'voice_memo' and a.created_at >= v_day_start
  ) >= c_voice_memo_daily_runs then
    return query select 'voice_memo_limit'::text, v_global, null::date, v_new, v_cost, v_cap, v_user;
    return;
  end if;
  -- 投稿のフォーマットを AI とつくる（post_format）は 1 人 1 日 10 回まで（voice_memo と同じ数え方。src/lib/post-formats/schema.ts の POST_FORMAT_DAILY_RUNS と同じ値）
  if p_purpose = 'post_format' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'post_format' and a.created_at >= v_day_start
  ) >= c_post_format_daily_runs then
    return query select 'post_format_limit'::text, v_global, null::date, v_new, v_cost, v_cap, v_user;
    return;
  end if;
  -- シリーズの次の回の案（post_format_round）は 1 人 1 日 20 回まで（同じ数え方。src/lib/post-formats/series.ts の SERIES_DAILY_RUNS と同じ値）
  if p_purpose = 'post_format_round' and (
    select count(*) from public.ai_usage a where a.owner_id = p_owner_id and a.purpose = 'post_format_round' and a.created_at >= v_day_start
  ) >= c_post_format_round_daily_runs then
    return query select 'post_format_round_limit'::text, v_global, null::date, v_new, v_cost, v_cap, v_user;
    return;
  end if;

  return query select 'ok'::text, v_global, case when v_new then v_new_until end, v_new, v_cost, v_cap, v_user;
end;
$$;

comment on function public.ai_budget_check(uuid, text, numeric, uuid, timestamptz) is 'AI の上限（関数の中で固定）と数え方。reserve_ai_usage と ai_budget_status だけが使う。user_cap_usd はこの人のいまの月の枠（登録して 7 日までは 1/3）';
revoke all on function public.ai_budget_check(uuid, text, numeric, uuid, timestamptz) from public, anon, authenticated, service_role;

-- 2. 予約（呼び出し方・返す値は前と同じ）。確かめと運営者が止めているときの断りは、前と同じ順で先にする
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
  -- 1 回の呼び出しで予約できる見込みの上限（src/lib/ai/budget.ts の AI_MAX_RESERVATION_USD と同じ値）
  c_max_reservation_usd constant numeric := 1;
  v_auto boolean := p_purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene');
  r record;
  v_id uuid;
begin
  if p_owner_id is null or p_cost_usd is null or p_cost_usd <= 0 or p_cost_usd > c_max_reservation_usd then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  -- 運営者が利用者ごとに止めている間は、自動の投稿の AI を断る（ジョブも「見本を作る」もここを通る）。知らない用途は自動の投稿ではないので、ここを通り過ぎて ai_budget_check が断る
  if v_auto and public.auto_post_held(p_owner_id) then
    return query select null::uuid, 'auto_post_hold'::text, 0::numeric, null::date;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_usage'));
  select * into r from public.ai_budget_check(p_owner_id, p_purpose, p_cost_usd, p_scope_owner, p_as_of);
  if r.status <> 'ok' then
    return query select null::uuid, r.status, r.global_month_usd, r.new_until;
    return;
  end if;

  insert into public.ai_usage (owner_id, thread_id, purpose, model, cost_usd, status, by_new_user)
  values (p_owner_id, p_thread_id, p_purpose, 'reserved', r.cost_usd, 'reserved', r.by_new_user)
  returning id into v_id;
  return query select v_id, 'ok'::text, r.global_month_usd + r.cost_usd, r.new_until;
end;
$$;

comment on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) is '文章の AI を呼ぶ前に、上限（ai_budget_check の中で固定）を確かめて見込みの費用で予約する。見込みは用途ごとの下限と 1 回の上限（$1）で挟む。自動の投稿（auto_post・auto_post_check など）は別の枠で数え、運営者が止めている人は断る。断った分は記録しない';
revoke all on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) to service_role;

-- 3. 本人の、いまの状態（読むだけ。予約しない）。画面の帯に使う。金額・全体の使った量は返さない
-- status: ok と、予約が断るときと同じ名前（user_limit・new_user_limit・global_limit・new_global_limit・daily_limit・用途ごとの 1 日の上限）
-- available_from: 断られているときに、また使えるようになる日（日本時間）。月の枠は来月 1 日、登録して 7 日までの枠はその次の日、1 日の上限は明日
-- low: 使えるが、この人の月の枠の 9 割を使った
create function public.ai_budget_status(p_purpose text default 'consult')
returns table (status text, available_from date, low boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  r record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- ふだんの用途だけ（自動の投稿の枠は、画面の帯では出さない）
  if p_purpose is null or p_purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene') then
    raise exception 'invalid purpose' using errcode = '22023';
  end if;
  -- 見込みは用途の下限（いちばん小さい呼び出しが通るか）で見る
  select * into r from public.ai_budget_check(v_uid, p_purpose, 0, null, null);
  return query select
    r.status,
    case
      when r.status in ('user_limit', 'global_limit') then (date_trunc('month', v_today) + interval '1 month')::date
      when r.status in ('new_user_limit', 'new_global_limit') then r.new_until
      when r.status = 'ok' then null::date
      else v_today + 1
    end,
    r.status = 'ok' and r.user_month_usd >= r.user_cap_usd * 0.9;
end;
$$;

comment on function public.ai_budget_status(text) is '本人の AI の枠の状態（ok か断られる理由・また使える日・残り 1 割を切ったか）。金額は返さない。数え方は ai_budget_check（reserve_ai_usage と同じ）';
revoke all on function public.ai_budget_status(text) from public, anon, authenticated, service_role;
grant execute on function public.ai_budget_status(text) to authenticated;
