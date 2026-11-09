-- 過去の自分の投稿から文調をそろえる（段階 A-2。docs/design/voice-from-posts.md の 3・4。2026-11-09 PM の了承）。
-- 1. アカウント設計に「書き方」（voice。文調のメモと例の投稿）のセクションを足す。中身の形はアプリ側（src/lib/plan/schema.ts）で確かめ、
--    例の投稿は保存の前にアプリが「このプロジェクトの、送った、本人が書いた投稿」に絞る（src/lib/plan/save.ts）
-- 2. 文調のメモをつくる AI の用途 voice_memo を、予約の用途に足す（下限 $0.15。出力の上限 4,000 から。ほかの用途と同じ数え方）。
--    1 人 1 日 3 回までも、予約の lock の中で数える（同時に押しても超えない。断るときは voice_memo_limit）

-- 2. 予約の用途（いちばん新しい定義 20261103170000 に、voice_memo の下限の 1 行と、1 日 3 回の判定を足す）
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

  insert into public.ai_usage (owner_id, thread_id, purpose, model, cost_usd, status, by_new_user)
  values (p_owner_id, p_thread_id, p_purpose, 'reserved', v_cost, 'reserved', v_new)
  returning id into v_id;
  return query select v_id, 'ok'::text, v_global + v_cost, case when v_new then v_new_until end;
end;
$$;

comment on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) is '文章の AI を呼ぶ前に、上限（関数の中で固定）を確かめて見込みの費用で予約する。見込みは用途ごとの下限と 1 回の上限（$1）で挟む。断った分は記録しない';

revoke all on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, text, numeric, uuid, uuid, timestamptz) to service_role;

-- 1. 設計のセクション（いちばん新しい定義 20261103180000 に、voice だけを足す）
create or replace function public.save_account_plan_section(p_project_id uuid, p_section text, p_value jsonb, p_source text default 'manual')
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value jsonb := p_value;
begin
  if p_section not in ('goal', 'story', 'audience', 'concept', 'ownership', 'profile', 'pillars', 'voice', 'hashtags', 'cadence', 'first_month') then
    raise exception 'unknown section: %', p_section using errcode = '22023';
  end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'section value must be an object' using errcode = '22023';
  end if;
  if p_source not in ('manual', 'ai') then
    raise exception 'unknown source: %', p_source using errcode = '22023';
  end if;

  if p_section = 'audience' then
    update public.projects set target_audience = coalesce(p_value->>'who', '') where id = p_project_id;
    if not found then
      raise exception 'project not found' using errcode = 'P0002';
    end if;
    v_value := p_value - 'who';
  end if;

  insert into public.account_plans (project_id, data, section_sources)
  values (p_project_id, jsonb_build_object(p_section, v_value), jsonb_build_object(p_section, p_source))
  on conflict (project_id) do update
    set data = public.account_plans.data || jsonb_build_object(p_section, v_value),
        section_sources = public.account_plans.section_sources || jsonb_build_object(p_section, p_source);
end;
$$;

-- 権限は前と同じ（本人の権限で呼ぶ。サーバーの管理者の鍵からは呼ばない）。本番でも同じ形になるよう書き直す
revoke all on function public.save_account_plan_section(uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_account_plan_section(uuid, text, jsonb, text) to authenticated;
