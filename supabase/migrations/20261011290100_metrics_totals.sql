-- 数字の画面（F07 の段取り ②）の週ごとの合計（docs/architecture.md の 4.22）。行を読んで足さず、DB で合計する。
-- security invoker なので、RLS（本人のものだけ）が効く。週は日本時間で、今週 = 直近 7 日、先週 = その前の 7 日
create function public.weekly_post_totals(p_project_id uuid, p_today date)
returns table (published_this_week bigint, published_last_week bigint, manual_views_this_week bigint, manual_views_last_week bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select t.id, (t.published_at at time zone 'Asia/Tokyo')::date as day
      from public.post_targets t
      join public.posts p on p.id = t.post_id
     where p.project_id = p_project_id
       and t.status = 'published'
       and t.published_at is not null
       and (t.published_at at time zone 'Asia/Tokyo')::date > p_today - 14
  )
  select count(*) filter (where t.day > p_today - 7),
         count(*) filter (where t.day <= p_today - 7),
         coalesce(sum(m.views) filter (where t.day > p_today - 7), 0),
         coalesce(sum(m.views) filter (where t.day <= p_today - 7), 0)
    from t
    left join public.manual_post_metrics m on m.post_target_id = t.id;
$$;

revoke execute on function public.weekly_post_totals(uuid, date) from public, anon, authenticated;
grant execute on function public.weekly_post_totals(uuid, date) to authenticated;
