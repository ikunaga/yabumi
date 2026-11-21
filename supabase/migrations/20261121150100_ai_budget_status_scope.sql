-- AI の枠の状態（20261121130100）のテスト用の直し: ai_budget_status_of に p_scope_owner を足す（2026-11-21 PM 了承。150000 は当たっているので別のファイルに）
-- テストのため、ai_budget_status_of（service_role だけ）に reserve_ai_usage と同じ p_scope_owner を足す（2026-11-21 PM 了承）。
-- 全体の合計を「本人と p_scope_owner の分だけ」で数え、共有のローカル DB でほかのテストと並行して流しても全体の上限に左右されないようにする。
-- 本人用の ai_budget_status は今と同じ（scope なし）
drop function public.ai_budget_status_of(uuid, text, timestamptz);

create function public.ai_budget_status_of(p_owner_id uuid, p_purpose text default 'consult', p_as_of timestamptz default null, p_scope_owner uuid default null)
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
  select * into r from public.ai_budget_check(p_owner_id, p_purpose, 0, p_scope_owner, p_as_of);
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

comment on function public.ai_budget_status_of(uuid, text, timestamptz, uuid) is 'AI の枠の状態（ok か断られる理由・また使える日・残り少しか）。金額は返さない。p_as_of・p_scope_owner はテスト用（7 日を過ぎた人として数える・全体を本人と p_scope_owner の分だけで数える）。service_role だけ';
revoke all on function public.ai_budget_status_of(uuid, text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.ai_budget_status_of(uuid, text, timestamptz, uuid) to service_role;

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
  return query select * from public.ai_budget_status_of(v_uid, p_purpose, null, null);
end;
$$;

revoke all on function public.ai_budget_status(text) from public, anon, authenticated, service_role;
grant execute on function public.ai_budget_status(text) to authenticated;
