-- 遅れて届くストアの数字（ダウンロード・ストアのページの閲覧）を、届いている日で終わる期間で数える（PM の依頼。正しくない数字を見せない）。
-- metrics_period_totals は今日で終わる期間の数え方で、終わりの日より後の行も「直近」に入れる（今日より後の行はないため）。
-- こちらは p_end（すべてのストアから届いているいちばん新しい日）より後の行を入れず、「p_end までの p_days 日」と「その前の p_days 日」を返す。
-- 数え方（どの取り込み元を足すか）は metrics_period_totals・store_weekly_totals と同じ。p_days は 7 か 30 だけ（ほかは 22023）。
-- security invoker で、RLS により本人のプロジェクトの行だけを数える

create function public.store_period_totals(p_project_id uuid, p_end date, p_days integer)
returns table (
  downloads_now bigint,
  downloads_prev bigint,
  page_views_now bigint,
  page_views_prev bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_days is null or p_days not in (7, 30) then
    raise exception '期間は 7 日か 30 日です（%）', p_days using errcode = '22023';
  end if;
  return query
  with store as (
    select d.day, d.source, d."values"
      from public.store_daily d
     where d.project_id = p_project_id
       and d.day > p_end - 2 * p_days
       and d.day <= p_end
  )
  select
    (select coalesce(sum((s."values" ->> 'downloads')::bigint), 0)::bigint from store s where s.source in ('app_store', 'google_play') and s.day > p_end - p_days),
    (select coalesce(sum((s."values" ->> 'downloads')::bigint), 0)::bigint from store s where s.source in ('app_store', 'google_play') and s.day <= p_end - p_days),
    (select coalesce(sum((s."values" ->> 'page_views')::bigint), 0)::bigint from store s where s.source in ('app_store_views', 'google_play') and s.day > p_end - p_days),
    (select coalesce(sum((s."values" ->> 'page_views')::bigint), 0)::bigint from store s where s.source in ('app_store_views', 'google_play') and s.day <= p_end - p_days);
end;
$$;

revoke execute on function public.store_period_totals(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.store_period_totals(uuid, date, integer) to authenticated;
