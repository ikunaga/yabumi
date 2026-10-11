-- 短縮リンクごとのクリックの合計（4.22、D20）。日ごとの集計の行を画面で読んで足すと、行が多いと数え漏れるので DB で合計する。
-- security invoker なので、RLS（本人の short_links・link_click_daily だけ）がそのまま効く。ログインした利用者が呼ぶ
create function public.link_click_totals(p_project_id uuid, p_today date)
returns table (link_id uuid, clicks_7d bigint, clicks_30d bigint, clicks_total bigint, excluded_total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id,
         coalesce(sum(d.clicks) filter (where d.day > p_today - 7), 0),
         coalesce(sum(d.clicks) filter (where d.day > p_today - 30), 0),
         coalesce(sum(d.clicks), 0),
         coalesce(sum(d.excluded), 0)
    from public.short_links l
    left join public.link_click_daily d on d.link_id = l.id
   where l.project_id = p_project_id
   group by l.id;
$$;

revoke execute on function public.link_click_totals(uuid, date) from public, anon, authenticated;
grant execute on function public.link_click_totals(uuid, date) to authenticated, service_role;
