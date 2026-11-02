-- 行き先の URL の 20 件の上限（20261102100000_general_product）を、同時に足されても超えないようにする（2026-11-02 のセキュリティチェックの Low）。
-- 数える前に、そのプロジェクトの行を for update で押さえ、同じプロジェクトへの足し込みを 1 つずつ順に通す。
-- security invoker のままなので、押さえられるのは本人が更新できる（RLS を通る）自分のプロジェクトだけ。他人のプロジェクトは何も押さえず、RLS の with check で断られる
create or replace function public.project_destinations_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.projects where id = new.project_id for update;
  if (select count(*) from public.project_destinations d where d.project_id = new.project_id) >= 20 then
    raise exception '行き先の URL は 1 つのプロジェクトに 20 までです' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.project_destinations_limit() from public, anon, authenticated;
