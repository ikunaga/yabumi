-- プロジェクトは 1 人 10 個まで（2026-11-07 オーナーの決定。自動のセキュリティの見直しで、プロジェクトの数に上限がなく、
-- プロジェクトにぶら下がる表（行き先の URL・絵の説明のフォーマットなど）を 1 人でいくらでもふくらませられるとわかった）。
-- 利用者ごとの advisory lock を取ってから数えるので、同時に作っても 10 個を超えない。上限は関数の中で固定（アプリの MAX_PROJECTS_PER_USER と同じ値）。
-- いま 10 個を超えている人がいても、消さない（新しく作れなくなるだけ）
create function public.projects_check_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_projects constant integer := 10;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('projects_limit:' || new.owner_id::text));
  select count(*) into v_count from public.projects p where p.owner_id = new.owner_id;
  if v_count >= c_max_projects then
    raise exception 'project_limit' using errcode = 'P0001', detail = 'projects per user: ' || c_max_projects;
  end if;
  return new;
end;
$$;

revoke all on function public.projects_check_limit() from public, anon, authenticated, service_role;

create trigger projects_check_limit
  before insert on public.projects
  for each row execute function public.projects_check_limit();
