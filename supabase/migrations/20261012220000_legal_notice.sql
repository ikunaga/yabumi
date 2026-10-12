-- 利用規約・プライバシーポリシーの変更の知らせを、全員にメールで送った記録（決定 D31。docs/architecture.md の 4.30）。
-- 運営者が「全員に送る」を押すと送り始め（legal_notice_campaigns）、Resend の 1 日の上限を超える分は毎日のジョブが続きを送る。
-- 送った記録（legal_notice_sends）で、同じ人に同じ版の知らせを二重に送らない。読み書きはサーバー（secret キー）だけ。
-- 退会すると、その人の送った記録は消える（auth.users からのカスケード）。版の施行日から 1 年たった記録は消す

create table public.legal_notice_campaigns (
  -- 版（施行日の ISO "YYYY-MM-DD"。src/lib/legal/version.ts の LEGAL_VERSIONS）
  version text primary key check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  started_at timestamptz not null default now(),
  -- 送り終えた日時（送る相手がもういなくなったら入れる）
  finished_at timestamptz
);

create table public.legal_notice_sends (
  version text not null references public.legal_notice_campaigns (version) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- sending: 送っている途中（送ったかわからないので、二重に送らないよう、自動ではやり直さない）。sent: 送った。failed: 送れなかった（次の回にやり直す）
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempts int not null default 1 check (attempts between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (version, user_id)
);

comment on table public.legal_notice_campaigns is '規約・ポリシーの変更の知らせを全員に送り始めた記録（D31。4.30）';
comment on table public.legal_notice_sends is '規約・ポリシーの変更の知らせを送った記録。二重に送らないため（D31。4.30）';

create index legal_notice_sends_updated_idx on public.legal_notice_sends (updated_at);

alter table public.legal_notice_campaigns enable row level security;
alter table public.legal_notice_sends enable row level security;
-- ポリシーは作らない（anon・authenticated からは何もできない）
revoke all on table public.legal_notice_campaigns from anon, authenticated;
revoke all on table public.legal_notice_sends from anon, authenticated;
grant all on table public.legal_notice_campaigns to service_role;
grant all on table public.legal_notice_sends to service_role;

-- ===== 毎日のジョブ（日本時間 9:10 = UTC 0:10）で続きを送り、古い記録を片付ける =====
select cron.schedule('yabumi-legal-notice', '10 0 * * *', $$select public.invoke_job('/api/jobs/legal-notice')$$);
select cron.schedule(
  'yabumi-purge-legal-notice',
  '55 18 * * *',
  $$delete from public.legal_notice_campaigns where version::date < (now() at time zone 'Asia/Tokyo')::date - 365$$
);
