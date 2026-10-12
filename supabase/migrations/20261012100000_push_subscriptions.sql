-- スマホの通知（Web Push）の宛先（docs/architecture.md の 4.28）。端末（ブラウザ）ごとに 1 行。
-- 登録はサーバー（secret キー）だけが書く（同じ端末で別の利用者が登録し直したら、宛先をその人に移すため）。
-- 本人は自分の端末の一覧を読み、外せる。退会すると auth.users からのカスケードで消える。
-- 送れなくなった宛先（push サービスが 404・410 を返したもの）は、送るときにサーバーが消す

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- push サービス（Apple・Google・Mozilla・Microsoft）の宛先の URL。サーバーは許可したホストにだけ送る（4.28）
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  -- 中身を暗号化するための、ブラウザの公開鍵と合言葉（RFC 8291）
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  -- 画面に出す端末の名前（例「iPhone」「Android の Chrome」）
  device_label text not null default '' check (char_length(device_label) <= 60),
  created_at timestamptz not null default now(),
  -- 最後に届けられた日時（push サービスが受け取った日時）
  last_success_at timestamptz,
  -- 「試しに送る」を最後に押した日時（続けて押せないように）
  test_sent_at timestamptz
);

comment on table public.push_subscriptions is 'スマホの通知（Web Push）の宛先。端末ごと（4.28）';

create index push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 権限はポリシーと同じ操作だけ（20261011220100_explicit_grants の決まり）。書き込みはサーバーだけ。
-- 暗号の鍵（p256dh・auth）は画面に要らないので、本人にも読ませない
revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, user_id, endpoint, device_label, created_at, last_success_at) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;
