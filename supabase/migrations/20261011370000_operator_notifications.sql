-- 運営者への知らせ（メール）を、同じ件で何度も送らないための記録（docs/architecture.md の 4.22「悪用への備え」。2026-10-11、オーナーの決定 D22）。
-- 例: Google Play のつなぎの作成数が直近 30 日で 60・80 に達したとき、それぞれ 30 日に 1 回だけ知らせる。
-- 中身は知らせの名前（key）と送った日時だけで、利用者の情報は持たない。サーバー（service_role）だけが扱う

create table public.operator_notifications (
  key text primary key check (char_length(key) between 1 and 100),
  sent_at timestamptz not null default now()
);

alter table public.operator_notifications enable row level security;
revoke all on public.operator_notifications from anon, authenticated;

-- 知らせてよいかを確かめて、記録する（同時に呼ばれても 1 回だけ true）。
-- 前に送ってから p_window たっていなければ false
create function public.claim_operator_notification(p_key text, p_window interval)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with claimed as (
    insert into public.operator_notifications as n (key, sent_at) values (p_key, now())
    on conflict (key) do update set sent_at = now() where n.sent_at < now() - p_window
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_operator_notification(text, interval) from public, anon, authenticated;
grant execute on function public.claim_operator_notification(text, interval) to service_role;
