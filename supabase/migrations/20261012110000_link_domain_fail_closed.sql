-- 利用者のドメイン（D28）を、確かめられないときは閉じる側に倒す（2026-10-12、セキュリティの見直しの指摘。docs/architecture.md の 4.22）
-- 1. 20261012080000 より前から active だった行は、合言葉がなく、矢書の持ち主の確認をしていない。合言葉を作り、pending に戻す
-- 2. 「active なら持ち主の確認が済んでいる」を DB で守る（コードの判定が漏れても、確認していないドメインでリンクを開かない）
-- 3. DNS で最後に確かめられた日時（dns_confirmed_at）を持ち、毎日の見回りでリゾルバが答えない日が 3 日を超えたら pending に戻す

alter table public.link_domains
  -- 矢書の持ち主の確認と CNAME が、最後に DNS で確かめられた日時（つながったとき・毎日の見回りで確かめられたとき）
  add column dns_confirmed_at timestamptz;

update public.link_domains
  set ownership_token = encode(extensions.gen_random_bytes(24), 'hex')
  where ownership_token = '';

update public.link_domains
  set status = 'pending', last_check = 'owner_txt_missing', pending_since = now()
  where status = 'active' and owner_verified_at is null;

update public.link_domains
  set dns_confirmed_at = owner_verified_at
  where status = 'active';

alter table public.link_domains add constraint link_domains_active_owner_verified
  check (status <> 'active' or (owner_verified_at is not null and char_length(ownership_token) >= 32));
