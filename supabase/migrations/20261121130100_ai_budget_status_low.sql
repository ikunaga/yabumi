-- AI の枠の状態（20261121130000）の直し（2026-11-21 PM 了承）。
-- 1. low（残り少し）を「使った額 ＋ 次の 1 回の下限 ≥ 月の枠の 9 割」にする。予約は用途の下限で見るので、前の「使った額 ≥ 9 割」では、
--    登録して 7 日までの人（枠 $1・相談の下限 $0.15）は 9 割に届く前に断られ、low が出なかった
-- 2. 中身を ai_budget_status_of（service_role だけ。p_as_of で「7 日を過ぎた人」として数えられる。reserve_ai_usage と同じ扱い）に移し、
--    ai_budget_status は本人（auth.uid()）でそれを呼ぶだけにする。結合テストで、ふつうの人の境目を確かめるため
create function public.ai_budget_status_of(p_owner_id uuid, p_purpose text default 'consult', p_as_of timestamptz default null)
returns table (status text, available_from date, low boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  r record;
begin
  if p_owner_id is null then
    raise exception 'invalid owner' using errcode = '22023';
  end if;
  -- ふだんの用途だけ（自動の投稿の枠は、画面の帯では出さない）
  if p_purpose is null or p_purpose in ('auto_post', 'auto_post_check', 'auto_post_sample', 'auto_post_scene') then
    raise exception 'invalid purpose' using errcode = '22023';
  end if;
  -- 見込みは用途の下限（いちばん小さい呼び出しが通るか）で見る。cost_usd は下限になって返る
  select * into r from public.ai_budget_check(p_owner_id, p_purpose, 0, null, p_as_of);
  return query select
    r.status,
    case
      when r.status in ('user_limit', 'global_limit') then (date_trunc('month', v_today) + interval '1 month')::date
      when r.status in ('new_user_limit', 'new_global_limit') then r.new_until
      when r.status = 'ok' then null::date
      else v_today + 1
    end,
    r.status = 'ok' and r.user_month_usd + r.cost_usd >= r.user_cap_usd * 0.9;
end;
$$;

comment on function public.ai_budget_status_of(uuid, text, timestamptz) is 'AI の枠の状態（ok か断られる理由・また使える日・残り少しか）。金額は返さない。p_as_of はテスト用（7 日を過ぎた人として数える）。service_role だけ';
revoke all on function public.ai_budget_status_of(uuid, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.ai_budget_status_of(uuid, text, timestamptz) to service_role;

create or replace function public.ai_budget_status(p_purpose text default 'consult')
returns table (status text, available_from date, low boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return query select * from public.ai_budget_status_of(v_uid, p_purpose, null);
end;
$$;

comment on function public.ai_budget_status(text) is '本人の AI の枠の状態（ai_budget_status_of を本人で呼ぶ）。金額は返さない';
revoke all on function public.ai_budget_status(text) from public, anon, authenticated, service_role;
grant execute on function public.ai_budget_status(text) to authenticated;
