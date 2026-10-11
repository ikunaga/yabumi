-- AI の費用の上限（docs/architecture.md の 4.9）の判定に使う合計を、DB で足し合わせる。
-- これまでは今月の ai_usage の行をすべて読んで画面側で足していたが、Supabase の API は 1 回に 1,000 行までしか返さないので、
-- 行が 1,000 を超えると数え漏れ、上限を超えても AI を使えてしまう（2026-10-11、ローカルの行が 1,237 になって結合テストで見つかった。1 人が 1 日 60 回使うと月 1,800 行になる）

create function public.ai_usage_totals(p_owner_id uuid, p_month_start timestamptz, p_day_start timestamptz)
returns table (global_month_usd numeric, owner_month_usd numeric, owner_today_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0),
         coalesce(sum(cost_usd) filter (where owner_id = p_owner_id), 0),
         (count(*) filter (where owner_id = p_owner_id and created_at >= p_day_start))::integer
    from public.ai_usage
   where created_at >= p_month_start;
$$;

revoke execute on function public.ai_usage_totals(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_usage_totals(uuid, timestamptz, timestamptz) to service_role;
