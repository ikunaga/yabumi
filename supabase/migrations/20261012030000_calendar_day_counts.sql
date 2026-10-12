-- カレンダーの月の表示で、日ごとの投稿の数を DB で数える（2026-10-12、F06 の月の表示）。
-- 月の表示は 6 週分の投稿を一度に読むが、読む行には上限があるので、「ほか n 件」の数は行を数えずにここで数える。
-- 日付の区切りは日本時間（src/lib/time.ts と同じ）。security invoker なので RLS が効き、本人の投稿だけを数える
create function public.calendar_day_counts(p_project_id uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, posts integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select (planned_at at time zone 'Asia/Tokyo')::date as day, count(*)::integer as posts
    from public.posts
   where project_id = p_project_id
     and planned_at >= p_from
     and planned_at < p_to
   group by 1
   order by 1;
$$;

revoke execute on function public.calendar_day_counts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.calendar_day_counts(uuid, timestamptz, timestamptz) to authenticated, service_role;
