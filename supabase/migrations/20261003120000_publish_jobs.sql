-- フェーズ 1: SNS への送信と、予約時刻に送るジョブ（要求 F05, F06）。方針は docs/architecture.md の 4.7

-- ===== 配信先に送信の記録を足す =====
alter table public.post_targets
  add column external_url text,
  -- 送信を試みた回数。一時的な失敗のときだけ、間をあけてやり直す
  add column attempts integer not null default 0,
  add column next_attempt_at timestamptz,
  -- 送信中にした時刻。止まったままのものを見つけるのに使う
  add column locked_at timestamptz;

-- deleted: 送信済みのものを矢書から SNS 上で取り消した
alter table public.post_targets drop constraint post_targets_status_check;
alter table public.post_targets add constraint post_targets_status_check
  check (status in ('pending', 'publishing', 'published', 'failed', 'deleted'));

comment on column public.post_targets.status is 'pending: 送る前 / publishing: 送信中 / published: 送信済み / failed: 失敗 / deleted: SNS 上で取り消した';

create index post_targets_due_idx on public.post_targets (status, next_attempt_at) where status in ('pending', 'publishing');

-- 送信の結果（状態、SNS 側の投稿 ID など）はサーバーだけが書く。
-- 利用者が書けるのは文面の調整と送り先のアカウントだけにして、「送信済み」の偽装や二重送信のきっかけを防ぐ
revoke insert, update on public.post_targets from authenticated, anon;
grant insert (post_id, owner_id, sns, body_override, social_account_id) on public.post_targets to authenticated;
grant update (body_override, social_account_id) on public.post_targets to authenticated;

-- ===== 失敗した配信先を送り直せる状態に戻す（利用者が「もう一度送る」「今すぐ送る」「予約」を押したとき） =====
create function public.requeue_failed_targets(p_post_id uuid, p_sns text[]) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- security definer なので、本人の投稿であることをここで確かめる
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.owner_id = (select auth.uid())) then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  update public.post_targets
    set status = 'pending', attempts = 0, next_attempt_at = null, locked_at = null, error_message = null
    where post_id = p_post_id and status = 'failed' and sns = any (p_sns);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.requeue_failed_targets(uuid, text[]) from public, anon;
grant execute on function public.requeue_failed_targets(uuid, text[]) to authenticated;

-- ===== 送る時刻が来た配信先を取り出して「送信中」にする =====
-- for update skip locked と状態の書き換えを 1 つの文で行うので、ジョブが重なっても同じ配信先を 2 回取り出さない。
-- p_post_id を渡すと、その投稿だけを対象にする（「今すぐ送る」）。
create function public.claim_due_targets(p_limit integer default 10, p_post_id uuid default null)
returns table (
  target_id uuid,
  post_id uuid,
  sns text,
  social_account_id uuid,
  account_external_id text,
  account_status text,
  body text,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 送信中のまま 10 分たったものは、送れたかどうかわからないので失敗にする（自動ではやり直さない。二重投稿を避けるため）
  update public.post_targets t
    set status = 'failed', locked_at = null,
        error_message = '送信の途中で止まりました。SNS 側に投稿されているか確かめてから、必要ならもう一度送ってください。'
    where t.status = 'publishing' and t.locked_at < now() - interval '10 minutes';

  return query
  with due as (
    select t.id
      from public.post_targets t
      join public.posts p on p.id = t.post_id
     where t.status = 'pending'
       and p.status = 'scheduled'
       -- 「今すぐ送る」（p_post_id あり）は時刻を見ない。アプリと DB の時計のずれで取りこぼさないため
       and (p.planned_at <= now() or p.id = p_post_id)
       and (t.next_attempt_at is null or t.next_attempt_at <= now() or p.id = p_post_id)
       and (p_post_id is null or p.id = p_post_id)
     order by p.planned_at, t.id
     limit p_limit
     for update of t skip locked
  ),
  claimed as (
    update public.post_targets t
       set status = 'publishing', locked_at = now(), attempts = t.attempts + 1
      from due
     where t.id = due.id
    returning t.id, t.post_id, t.sns, t.social_account_id, t.body_override, t.attempts
  )
  select c.id, c.post_id, c.sns::text, c.social_account_id, a.external_id, a.status,
         coalesce(c.body_override, p.body), c.attempts
    from claimed c
    join public.posts p on p.id = c.post_id
    left join public.social_accounts a on a.id = c.social_account_id;
end;
$$;

-- ジョブ（secret キー）だけが呼べる
revoke execute on function public.claim_due_targets(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_due_targets(integer, uuid) to service_role;

-- ===== 定期実行（pg_cron → pg_net → Next.js のジョブ API） =====
create extension if not exists pg_cron with schema pg_catalog;

-- 呼び先の URL と合言葉は Vault に置く（app_url / cron_secret）。どちらかがなければ何もしない。
-- 設定方法は README の「予約投稿のジョブ」
create function public.invoke_job(p_path text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke execute on function public.invoke_job(text) from public, anon, authenticated;

-- 毎分: 予約時刻が来た投稿を送る
select cron.schedule('yabumi-publish', '* * * * *', $$select public.invoke_job('/api/jobs/publish')$$);
-- 毎日 3:00（日本時間）: 期限が近いトークンを延長する
select cron.schedule('yabumi-refresh-tokens', '0 18 * * *', $$select public.invoke_job('/api/jobs/refresh-tokens')$$);
