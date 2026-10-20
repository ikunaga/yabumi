-- アカウント設計に「ハッシュタグ」のセクションを足す（2026-10-20）。
-- 中身の形はアプリ側（src/lib/plan/schema.ts の hashtags）で確かめる。DB はセクションの名前だけを見る。
-- create or replace なので、権限（authenticated だけが実行できる）はそのまま残る
create or replace function public.save_account_plan_section(p_project_id uuid, p_section text, p_value jsonb, p_source text default 'manual')
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value jsonb := p_value;
begin
  if p_section not in ('goal', 'audience', 'ownership', 'profile', 'pillars', 'hashtags', 'cadence', 'first_month') then
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
