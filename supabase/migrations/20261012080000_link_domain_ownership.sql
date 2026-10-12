-- 利用者のドメイン（D28）の直し（2026-10-12、セキュリティの見直しの指摘。docs/architecture.md の 4.22）
-- 1. 矢書が持ち主を確かめる: 利用者ごと・ドメインごとの合言葉を DNS の TXT（_yabumi.<ドメイン>）に入れてもらい、合うまで active にしない。
--    Vercel は、ほかの Vercel のアカウントが使っていないドメインなら TXT を求めずに verified を返すので、
--    他人のドメインが使われなくなった Vercel を CNAME で指したまま残っていると、持ち主でない人がつなげてしまうため
-- 2. つながらないまま 7 日たったドメインは取り消す（矢書全体の枠と、ほかの人が使えないドメインを、いつまでも押さえられないように）
-- 3. 毎日のジョブで、つながったドメインの TXT と CNAME がまだ残っているか確かめ、外れていたら矢書のドメインに戻す

alter table public.link_domains
  -- 持ち主の確認の合言葉（サーバーが足すときに作る。推測できない長さ）。TXT の値は yabumi-verify=<合言葉>
  add column ownership_token text not null default '' check (char_length(ownership_token) <= 100),
  -- 矢書の持ち主の確認が通った日時
  add column owner_verified_at timestamptz,
  -- pending になった日時（足したとき、または外れて戻したとき）。ここから 7 日で取り消す
  add column pending_since timestamptz not null default now();

-- 最後に確かめた結果に、owner_txt_missing（矢書の持ち主の確認の TXT がない）を足す
alter table public.link_domains drop constraint link_domains_last_check_check;
alter table public.link_domains add constraint link_domains_last_check_check
  check (last_check in ('', 'dns_missing', 'wrong_value', 'proxied', 'txt_missing', 'owner_txt_missing', 'cert_pending', 'ok', 'error'));

create index link_domains_pending_idx on public.link_domains (pending_since) where status = 'pending';

-- つながらないまま 7 日たったドメインを取り消す（行を消すと、トリガーが Vercel から外す列に積む）。消した数を返す
create function public.expire_link_domains() returns int
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.link_domains d where d.status = 'pending' and d.pending_since < now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expire_link_domains() from public, anon, authenticated;
grant execute on function public.expire_link_domains() to service_role;

-- 枠を取る（合言葉を受け取るようにし、先に期限切れの pending を取り消す）
drop function public.claim_link_domain(uuid, uuid, text, int, int);

create function public.claim_link_domain(p_owner uuid, p_project uuid, p_domain text, p_token text, p_daily int, p_total int)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_total int;
begin
  perform pg_advisory_xact_lock(hashtext('link_domains'));
  if char_length(p_token) < 32 then
    raise exception 'ownership token too short';
  end if;
  perform public.expire_link_domains();
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
  insert into public.link_domains (owner_id, project_id, domain, ownership_token) values (p_owner, p_project, p_domain, p_token);
  return 'ok';
end;
$$;

revoke execute on function public.claim_link_domain(uuid, uuid, text, text, int, int) from public, anon, authenticated;
grant execute on function public.claim_link_domain(uuid, uuid, text, text, int, int) to service_role;

-- 毎日 4:40（日本時間）に、つながったドメインの DNS がまだ残っているかを確かめ、期限切れの pending を取り消す
select cron.schedule('yabumi-check-link-domains', '40 19 * * *', $$select public.invoke_job('/api/jobs/check-link-domains')$$);
