-- 短縮リンクを利用者のドメインで作る（F07、決定 D28。docs/architecture.md の 4.22）。
-- プロジェクトごとに 1 つ、利用者が持っているドメイン（おすすめは go.<自分のドメイン>）を短縮リンクに使う。
-- 矢書が Vercel の API でドメインを矢書のプロジェクトに足し、利用者が DNS に 1 行足して、「確かめる」でつながったら使い始める。
-- 書き込みはサーバー（secret キー）だけ。Vercel の側と食い違わないよう、利用者が直接は書けない

-- ===== 利用者のドメイン =====
create table public.link_domains (
  id uuid primary key default gen_random_uuid(),
  -- 1 利用者 1 ドメインまで（Vercel Hobby の 1 プロジェクトのドメインの上限が 50 のため。4.22）
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  project_id uuid not null unique references public.projects (id) on delete cascade,
  -- 小文字・末尾の点なし・国際化ドメインは xn-- の形（サーバーで直してから入れる）。ほかの人がすでに使っていれば入れられない
  domain text not null unique check (
    char_length(domain) <= 253
    and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  -- pending: DNS の設定を待っている / active: つながった（このドメインで短縮リンクを作る・開く）
  status text not null default 'pending' check (status in ('pending', 'active')),
  -- 利用者に入れてもらう DNS の行（Vercel が返した値。CNAME の向け先と、所有の確認の TXT が要るときはその名前と値）
  cname_target text not null default '' check (char_length(cname_target) <= 253),
  txt_name text not null default '' check (char_length(txt_name) <= 253),
  txt_value text not null default '' check (char_length(txt_value) <= 500),
  -- 最後に確かめた結果（画面に出す。dns_missing: まだ届いていない / wrong_value: 値が違う / proxied: Cloudflare の Proxy がオン /
  -- txt_missing: 所有の確認の TXT がない / cert_pending: 証明書を待っている / ok: つながった / error: Vercel に問い合わせられなかった）
  last_check text not null default '' check (last_check in ('', 'dns_missing', 'wrong_value', 'proxied', 'txt_missing', 'cert_pending', 'ok', 'error')),
  last_checked_at timestamptz,
  -- つながった日時
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.link_domains is '短縮リンクに使う利用者のドメイン（F07、D28。4.22）';

create trigger link_domains_set_updated_at
  before update on public.link_domains
  for each row execute function public.set_updated_at();

alter table public.link_domains enable row level security;

create policy "link_domains_select_own" on public.link_domains
  for select to authenticated using ((select auth.uid()) = owner_id);

-- 利用者は読むだけ（書き込みはサーバーが Vercel とそろえて行う）
revoke all on public.link_domains from anon, authenticated;
grant select on public.link_domains to authenticated;

-- ===== ドメインを足した回数（悪用への備え。1 日の回数の上限） =====
-- 足すたびに 1 行。7 日より古い行は、次に足すときに消す。利用者からは読めない
create table public.link_domain_attempts (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  domain text not null check (char_length(domain) <= 253),
  created_at timestamptz not null default now()
);

create index link_domain_attempts_owner_idx on public.link_domain_attempts (owner_id, created_at);

alter table public.link_domain_attempts enable row level security;
revoke all on public.link_domain_attempts from anon, authenticated;

-- ===== Vercel から外すドメイン =====
-- ドメインの行が消えたら（外す・プロジェクトの削除・退会）、Vercel から外すまでここに残す。
-- Vercel に残ったままだと、ほかの人が使えず、矢書全体の上限の枠も埋まるため。サーバーが Vercel から外せたら消す
create table public.link_domain_removals (
  domain text primary key check (char_length(domain) <= 253),
  created_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text not null default '' check (char_length(last_error) <= 500)
);

alter table public.link_domain_removals enable row level security;
revoke all on public.link_domain_removals from anon, authenticated;

create function public.queue_link_domain_removal() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.link_domain_removals (domain) values (old.domain) on conflict (domain) do nothing;
  return old;
end;
$$;

revoke execute on function public.queue_link_domain_removal() from public, anon, authenticated;

create trigger link_domains_queue_removal
  after delete on public.link_domains
  for each row execute function public.queue_link_domain_removal();

-- ===== ドメインの枠を取る =====
-- 矢書全体の上限・1 日の回数・ほかの人の使用を、同じロックの中で確かめてから行を入れる（同時に足しても上限を超えない）。
-- 返り値: ok / not_found（本人のプロジェクトでない）/ already（もう 1 つ持っている）/ taken（ほかの人が使っている・外す途中）/
-- daily（1 日の回数の上限）/ limit（矢書全体の上限）
create function public.claim_link_domain(p_owner uuid, p_project uuid, p_domain text, p_daily int, p_total int)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_total int;
begin
  perform pg_advisory_xact_lock(hashtext('link_domains'));
  if not exists (select 1 from public.projects p where p.id = p_project and p.owner_id = p_owner) then
    return 'not_found';
  end if;
  if exists (select 1 from public.link_domains d where d.owner_id = p_owner or d.project_id = p_project) then
    return 'already';
  end if;
  -- 外す途中のドメインは、Vercel から外れるまで使えない（Vercel の側でまだ矢書のプロジェクトに付いているため）
  if exists (select 1 from public.link_domains d where d.domain = p_domain)
     or exists (select 1 from public.link_domain_removals r where r.domain = p_domain) then
    return 'taken';
  end if;
  delete from public.link_domain_attempts a where a.owner_id = p_owner and a.created_at < now() - interval '7 days';
  if (select count(*) from public.link_domain_attempts a where a.owner_id = p_owner and a.created_at > now() - interval '1 day') >= p_daily then
    return 'daily';
  end if;
  -- Vercel の枠は、使っているドメインと外す途中のドメインの合計で数える
  select (select count(*) from public.link_domains) + (select count(*) from public.link_domain_removals) into v_total;
  if v_total >= p_total then
    return 'limit';
  end if;
  insert into public.link_domain_attempts (owner_id, domain) values (p_owner, p_domain);
  insert into public.link_domains (owner_id, project_id, domain) values (p_owner, p_project, p_domain);
  return 'ok';
end;
$$;

revoke execute on function public.claim_link_domain(uuid, uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.claim_link_domain(uuid, uuid, text, int, int) to service_role;
