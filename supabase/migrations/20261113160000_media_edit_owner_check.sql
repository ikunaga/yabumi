-- セキュリティ確認（2026-11-13 の 2 回目）の DB-L1・DB-L2。docs/architecture.md の 4.68
-- DB-L1: 整えた画像の元（20261113150000_media_edit_source）の original_id・edit_base_id・source_of が、同じ持ち主の行を指すことを DB でも縛る。
--   書くのは投稿の保存（サーバー。attachMedia が本人の行か確かめる）だけだが、サーバーの確かめが漏れても、ほかの人の画像を元にできないようにする。
--   あわせて、自分自身を元にしない check と、整え方（edit）の大きさの上限を足す
-- DB-L2: トリガーの関数の revoke に service_role を揃える（20261113130000 の posts_check_format・20261113140000 の post_format_rounds_limit）

-- update のときは、変わった列だけを確かめる（元の行が cascade で消えるとき、on delete set null が 1 列ずつ null にする。
-- そのとき、まだ消える途中の行を指すほかの列を確かめると止まってしまう）。持ち主が変わったときは全部を確かめる
create or replace function public.media_files_check_edit_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all boolean := tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id;
begin
  if new.original_id is not null and (v_all or new.original_id is distinct from old.original_id)
     and not exists (select 1 from public.media_files m where m.id = new.original_id and m.owner_id = new.owner_id) then
    raise exception 'original_id must reference the same owner' using errcode = '23514';
  end if;
  if new.edit_base_id is not null and (v_all or new.edit_base_id is distinct from old.edit_base_id)
     and not exists (select 1 from public.media_files m where m.id = new.edit_base_id and m.owner_id = new.owner_id) then
    raise exception 'edit_base_id must reference the same owner' using errcode = '23514';
  end if;
  if new.source_of is not null and (v_all or new.source_of is distinct from old.source_of)
     and not exists (select 1 from public.media_files m where m.id = new.source_of and m.owner_id = new.owner_id) then
    raise exception 'source_of must reference the same owner' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.media_files_check_edit_owner() from public, anon, authenticated, service_role;

create trigger media_files_check_edit_owner
  before insert or update of original_id, edit_base_id, source_of, owner_id on public.media_files
  for each row execute function public.media_files_check_edit_owner();

-- 自分自身を元にしない
alter table public.media_files add constraint media_files_source_not_self check (source_of is null or source_of <> id);
alter table public.media_files add constraint media_files_edit_not_self check ((original_id is null or original_id <> id) and (edit_base_id is null or edit_base_id <> id));
-- 整え方は、種類と見出しの設定・調整の値だけなので小さい（サーバーの zod の上限で 1KB ほど）。それより大きいものは入れない
alter table public.media_files add constraint media_files_edit_size check (edit is null or octet_length(edit::text) <= 4000);

-- DB-L2: トリガーの関数は、どのロールからも直接呼ばせない（トリガーとしては動く）
revoke all on function public.posts_check_format() from public, anon, authenticated, service_role;
revoke all on function public.post_format_rounds_limit() from public, anon, authenticated, service_role;
