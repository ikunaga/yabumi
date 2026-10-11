-- 今月（日本時間）に SNS へ払った額の合計を、DB で出す。p_owner_id を渡すと、その人の分だけ（画面の「今月の X の費用」）。
-- 行を読んで JavaScript で足すと、Supabase の API は 1 回に 1,000 行までしか返さないので、行が増えると数え漏れる
drop function public.sns_spend_this_month(public.sns_key);

create function public.sns_spend_this_month(p_sns public.sns_key, p_owner_id uuid default null)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
    from public.sns_api_usage
   where sns = p_sns
     and (p_owner_id is null or owner_id = p_owner_id)
     and created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
$$;

revoke execute on function public.sns_spend_this_month(public.sns_key, uuid) from public, anon, authenticated;
grant execute on function public.sns_spend_this_month(public.sns_key, uuid) to service_role;
