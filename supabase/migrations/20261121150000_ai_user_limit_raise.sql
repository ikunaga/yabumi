-- AI の 1 人あたりの月の枠を上げる（2026-11-21 オーナーの決定「いま自分が使えなくなっているので、上限を上げたい」。PM 経由）。
-- 上限の数は ai_budget_check（20261121130000）にまとめてあるので、その 2 つの値だけを変える。数え方・ほかの上限は変えない
-- - 文の AI の 1 人の月の枠: $3 → $9.9（みんなの合計 $10 のすぐ下。合計は変えないので、月の最大の費用は今と同じ。
--   合計と同じ $10 にすると、1 人で使い切ったときに先に「みんなの上限」で断られ、帯が事実と違う文になるため。2026-11-21 PM の判断）
-- - 自動投稿の文の AI の 1 人の月の枠: $3 → $4.9（合計 $5 のすぐ下。同じ理由）
-- - 変えないもの: みんなの合計（$10・$5）・画像の上限・1 日の回数・用途ごとの回数・登録して 7 日までは 1/3（新しい人の枠は $3.3・$1.63 になる。決め直すときに一緒に）・1 回の上限 $1
-- 招待の前に、プランと一緒に決め直す（docs/launch-checklist.md の 2.3）
create or replace function public.ai_budget_check(p_owner_id uuid, p_purpose text, p_cost_usd numeric, p_scope_owner uuid default null, p_as_of timestamptz default null)
returns table (status text, global_month_usd numeric, new_until date, by_new_user boolean, cost_usd numeric, user_cap_usd numeric, user_month_usd numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 1 人の月の枠（文の AI）。2026-11-21 オーナーの決定で $3 → $9.9（みんなの合計 $10 のすぐ下）。招待の前にプランと一緒に決め直す（launch-checklist 2.3）
  c_user_monthly_usd constant numeric := 9.9;
  c_global_monthly_usd constant numeric := 10;
  c_user_daily_turns constant integer := 60;
  c_voice_memo_daily_runs constant integer := 3;
  c_post_format_daily_runs constant integer := 10;
  c_post_format_round_daily_runs constant integer := 20;
  -- 自動の投稿の枠（docs/design/auto-post.md の A4。2026-11-16 オーナーが (a) に決めた）。ふだんの枠（上の 3 つ）とは別に数える
  -- 1 人の月の枠（自動投稿の文の AI）。2026-11-21 オーナーの決定で $3 → $4.9（合計 $5 のすぐ下）。招待の前にプランと一緒に決め直す（launch-checklist 2.3）
  c_auto_user_monthly_usd constant numeric := 4.9;
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
