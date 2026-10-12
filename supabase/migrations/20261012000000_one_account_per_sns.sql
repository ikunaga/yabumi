-- 1 つのプロジェクトに、SNS ごとにアカウントは 1 つ（docs/architecture.md の 4.6。2026-10-12）。
-- これまでは、つなぎ直すときに X が別のアカウントを返すと（ブラウザの x.com のログインが別のアカウントだったなど）、
-- social_accounts に新しい行ができ、プロジェクトに X が 2 つつながった。画面と送り先は「SNS ごとに最初の 1 つ」を使うので、
-- 新しいアカウントでつないだつもりでも、表示も送り先も古いアカウントのままだった。
-- そこで、つなぐときは switch_project_sns_account で付け替え（古いつながりを外し、送る前の配信先を新しいアカウントへ移す）、
-- DB の側でもトリガーで 2 つ目を入れられないようにする。

-- 先に、すでに重複していないかを確かめる（あれば止める。どちらを残すかは利用者に「外す」で選んでもらう）
do $$
begin
  if exists (
    select 1
      from public.project_social_accounts psa
      join public.social_accounts a on a.id = psa.social_account_id
     group by psa.project_id, a.sns
    having count(*) > 1
  ) then
    raise exception '同じプロジェクトに同じ SNS のアカウントが 2 つ以上つながっています。「つないだ SNS」の「外す」で 1 つにしてから当て直してください';
  end if;
end;
$$;

-- 2 つ目を入れられないようにする。project_social_accounts に sns の列はないので、つなぐアカウントの sns を見て確かめる。
-- 同時に 2 つつながないように、プロジェクトごとのロックの中で確かめる（switch_project_sns_account と同じロック）
create function public.project_social_accounts_one_per_sns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sns public.sns_key;
begin
  perform pg_advisory_xact_lock(hashtext('project_social_accounts:' || new.project_id::text));
  select sns into v_sns from public.social_accounts where id = new.social_account_id;
  if exists (
    select 1
      from public.project_social_accounts psa
      join public.social_accounts a on a.id = psa.social_account_id
     where psa.project_id = new.project_id
       and a.sns = v_sns
       and psa.social_account_id <> new.social_account_id
  ) then
    raise exception 'このプロジェクトには、すでに % のアカウントがつながっています', v_sns using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.project_social_accounts_one_per_sns() from public, anon, authenticated;

create trigger project_social_accounts_one_per_sns
  before insert on public.project_social_accounts
  for each row execute function public.project_social_accounts_one_per_sns();

-- つなぐ・つなぎ直す（どの SNS の callback も、Facebook のページの選択も、これを通す）。
-- 同じ SNS のほかのアカウントがこのプロジェクトにつながっていれば、
-- 1. このプロジェクトの、送る前（pending）と送れなかった（failed）配信先を新しいアカウントに付け替える
--    （予約は新しいアカウントから送る。送っている途中（preparing・publishing）のものは動かさない）
-- 2. 古いつながりを外し、新しいアカウントをつなぐ
-- 古いアカウントがほかのプロジェクトで使われていなければ、still_used = false を返す。
-- そのときは呼ぶ側が「外す」と同じ処理（X は取り消し、SNS から受け取ったものを消す、アカウントとトークンを消す）をする
create function public.switch_project_sns_account(p_owner_id uuid, p_project_id uuid, p_account_id uuid)
returns table (old_account_id uuid, old_handle text, old_display_name text, still_used boolean, moved_targets integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sns public.sns_key;
  v_old record;
  v_moved integer;
begin
  perform pg_advisory_xact_lock(hashtext('project_social_accounts:' || p_project_id::text));
  if not exists (select 1 from public.projects where id = p_project_id and owner_id = p_owner_id) then
    raise exception 'project not found';
  end if;
  select sns into v_sns from public.social_accounts where id = p_account_id and owner_id = p_owner_id;
  if v_sns is null then
    raise exception 'account not found';
  end if;

  for v_old in
    select a.id, a.handle, a.display_name
      from public.project_social_accounts psa
      join public.social_accounts a on a.id = psa.social_account_id
     where psa.project_id = p_project_id
       and a.sns = v_sns
       and a.id <> p_account_id
  loop
    update public.post_targets t
       set social_account_id = p_account_id
      from public.posts p
     where p.id = t.post_id
       and p.project_id = p_project_id
       and t.social_account_id = v_old.id
       and t.status in ('pending', 'failed');
    get diagnostics v_moved = row_count;

    delete from public.project_social_accounts where project_id = p_project_id and social_account_id = v_old.id;

    old_account_id := v_old.id;
    old_handle := v_old.handle;
    old_display_name := v_old.display_name;
    still_used := exists (select 1 from public.project_social_accounts where social_account_id = v_old.id);
    moved_targets := v_moved;
    return next;
  end loop;

  insert into public.project_social_accounts (project_id, social_account_id, owner_id)
  values (p_project_id, p_account_id, p_owner_id)
  on conflict do nothing;
end;
$$;

revoke execute on function public.switch_project_sns_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.switch_project_sns_account(uuid, uuid, uuid) to service_role;
