-- SNS 上で消された投稿の数字を消す（docs/architecture.md の 4.14・4.19。2026-10-11）。
-- X の Developer Policy は、元の投稿が消えたら、保存した X のデータも消すか直すよう求めている。矢書は、配信先が「消された」
-- （status = 'deleted'。矢書から取り消した・SNS の側で消されたのを見つけた・利用者が「SNS で消した」と記録した）になったときに、
-- その投稿の数字（post_metrics）も消す。どの SNS も同じ扱いにする。投稿の ID・URL は、20261011230000 のトリガーがすでに空にしている

create function public.delete_metrics_of_removed_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.post_metrics where post_target_id = new.id;
  return new;
end;
$$;

revoke execute on function public.delete_metrics_of_removed_target() from public, anon, authenticated;

create trigger post_targets_delete_metrics_when_removed
  after update of status on public.post_targets
  for each row
  when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.delete_metrics_of_removed_target();
