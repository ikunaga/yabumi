-- 招待の申し込み（F19、決定 D30。docs/architecture.md の 4.29）。ログイン前のトップ（/）から、招待制の試用（D24 の ②）に申し込む。
-- 書くのも読むのもサーバー（secret キー）だけ。anon・authenticated には何も渡さない（申し込みは server action が確かめてから入れる。
-- 一覧は運営者の画面か Supabase の画面で見る）。
-- 保存期間: 招待した・お断りした・本人が取り消したら、すぐ消す。そのどれでもなく 1 年たったら消す。
-- 1 時間あたりの上限に使う ip_hash（その日だけの鍵で作るハッシュ。IP アドレスそのものは持たない）は 1 日で空にする

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  -- 小文字にそろえて入れる（同じアドレスの二重の申し込みを防ぐ）
  email text not null unique check (char_length(email) between 3 and 254 and email = lower(email)),
  -- 任意の一言（作っているアプリ、使っている SNS）
  app_note text not null default '' check (char_length(app_note) <= 200),
  sns_note text not null default '' check (char_length(sns_note) <= 200),
  -- 確認のメールの「申し込みを取り消す」のリンクの合言葉のハッシュ（合言葉そのものは持たない）
  cancel_token_hash text not null unique check (char_length(cancel_token_hash) = 64),
  -- 1 時間あたりの上限のため（その日だけの鍵で作った IP アドレスのハッシュ）。1 日で空にする
  ip_hash text check (ip_hash is null or char_length(ip_hash) = 64),
  created_at timestamptz not null default now()
);

comment on table public.waitlist is '招待の申し込み（F19。4.29）。サーバーだけが読み書きする';

create index waitlist_created_idx on public.waitlist (created_at);
create index waitlist_ip_idx on public.waitlist (ip_hash, created_at) where ip_hash is not null;

alter table public.waitlist enable row level security;
-- ポリシーは作らない（anon・authenticated からは何もできない）
revoke all on table public.waitlist from anon, authenticated;
grant all on table public.waitlist to service_role;

-- ===== 片付け（日本時間 3:50 = UTC 18:50） =====
select cron.schedule(
  'yabumi-purge-waitlist',
  '50 18 * * *',
  $$delete from public.waitlist where created_at < now() - interval '1 year';
    update public.waitlist set ip_hash = null where ip_hash is not null and created_at < now() - interval '1 day'$$
);
