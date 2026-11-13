-- 投稿をつくったときに選んでいた投稿のフォーマット（PMO2 のやり直しの確かめ s8。2026-11-13 PM の了承）。
-- 下書きから再開したときに、フォーマットの選択を戻すために持つ。フォーマットを消したら空にする（投稿は残る）。
-- 本文と毎回付けるタグは投稿と配信先にもう保存してあるので、ここは選択の復元だけに使う（穴の言葉は持たない）

alter table public.posts add column format_id uuid references public.post_formats (id) on delete set null;

comment on column public.posts.format_id is '投稿をつくったときに選んでいた投稿のフォーマット（下書きから再開したときに選択を戻す）。同じ持ち主・同じプロジェクトのものだけ';

create index posts_format_idx on public.posts (format_id) where format_id is not null;

-- 同じ持ち主・同じプロジェクトのフォーマットだけを付けられる（他人のフォーマットの id を書かれても、RLS で読めないだけだが、守りを二重にする）。
-- security invoker なので、本人が読めるフォーマットだけが見つかる
create function public.posts_check_format()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.format_id is not null and not exists (
    select 1 from public.post_formats f where f.id = new.format_id and f.owner_id = new.owner_id and f.project_id = new.project_id
  ) then
    raise exception 'format not found' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.posts_check_format() from public, anon, authenticated;

create trigger posts_check_format
  before insert or update of format_id, project_id on public.posts
  for each row execute function public.posts_check_format();

-- posts は表ごと insert・update を許しているので（20261011220100_explicit_grants）、列の grant は足さなくてよい
