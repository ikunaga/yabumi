-- アカウント設計に「あなたらしさ」（story）と「コンセプト」（concept）のセクションを足す（2026-11-03 オーナーの了承）。
-- 中身の形はアプリ側（src/lib/plan/schema.ts）で確かめる。DB はセクションの名前だけを見る（20261020100000_plan_hashtags と同じ）。
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
  if p_section not in ('goal', 'story', 'audience', 'concept', 'ownership', 'profile', 'pillars', 'hashtags', 'cadence', 'first_month') then
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

-- 権限は前と同じ（本人の権限で呼ぶ。サーバーの管理者の鍵からは呼ばない）。本番でも同じ形になるよう書き直す
revoke all on function public.save_account_plan_section(uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_account_plan_section(uuid, text, jsonb, text) to authenticated;
