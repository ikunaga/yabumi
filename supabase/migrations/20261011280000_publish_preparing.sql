-- 画像の準備を、1 回の送信ジョブの中で待ち続けない（docs/architecture.md の 4.7「1 回のジョブの時間」）。
-- Threads・Instagram は画像を SNS 側が取りに来て処理するので、公開できるまで数秒〜数十秒かかる。
-- その間ジョブが待ち続けると、ジョブの時間の上限（60 秒）に届き、同じ回の後ろの配信先が送れなくなる。
-- そこで「準備中」（preparing）という状態を足し、SNS 側の準備の途中の状態（コンテナの ID）を記録して、次の回（1 分後）に続きを確かめる。

alter table public.post_targets drop constraint post_targets_status_check;
alter table public.post_targets add constraint post_targets_status_check
  check (status in ('pending', 'preparing', 'publishing', 'published', 'failed', 'deleted'));

comment on column public.post_targets.status is
  'pending: 送る前 / preparing: SNS 側で画像を準備中（次の回に続きを確かめる） / publishing: 送信中 / published: 送信済み / failed: 失敗 / deleted: SNS 上で取り消した';

-- SNS 側の準備の途中の状態（Threads・Instagram のコンテナの ID など。形はアダプターが決める）と、準備を始めた時刻
alter table public.post_targets add column sns_container jsonb check (sns_container is null or (jsonb_typeof(sns_container) = 'object' and pg_column_size(sns_container) <= 8192));
alter table public.post_targets add column preparing_since timestamptz;

comment on column public.post_targets.sns_container is 'SNS 側の準備の途中の状態（サーバーだけが書く）。準備中のときだけ入る';

-- 利用者が書き換えられる列（列ごとの権限。4.17）は増やさない。読むのは今までどおり

drop index if exists post_targets_due_idx;
create index post_targets_due_idx on public.post_targets (status, next_attempt_at) where status in ('pending', 'preparing', 'publishing');

-- ===== 送る時刻が来た配信先と、準備の続きを確かめる時刻が来た配信先を取り出す =====
-- 戻り値に sns_container を足すので、作り直す（引数は同じ）
drop function public.claim_due_targets(integer, uuid);

create function public.claim_due_targets(p_limit integer default 10, p_post_id uuid default null)
returns table (
  target_id uuid,
  post_id uuid,
  sns text,
  social_account_id uuid,
  account_external_id text,
  account_status text,
  body text,
  attempts integer,
  sns_container jsonb,
  preparing_since timestamptz
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
     where not public.is_manual_sns(t.sns)
       and (p_post_id is null or p.id = p_post_id)
       and (
         -- 送る時刻が来たもの。「今すぐ送る」（p_post_id あり）は時刻を見ない（アプリと DB の時計のずれで取りこぼさないため）
         (t.status = 'pending'
           and p.status = 'scheduled'
           and (p.planned_at <= now() or p.id = p_post_id)
           and (t.next_attempt_at is null or t.next_attempt_at <= now() or p.id = p_post_id))
         -- 準備中で、続きを確かめる時刻が来たもの
         or (t.status = 'preparing' and (t.next_attempt_at is null or t.next_attempt_at <= now()))
       )
     -- 準備中のもの（もう始めている）を先に、次に予約の時刻の早い順
     order by (t.status = 'preparing') desc, p.planned_at, t.id
     limit p_limit
     for update of t skip locked
  ),
  claimed as (
    update public.post_targets t
       -- 準備の続きを確かめるだけのときは、試した回数を増やさない
       set status = 'publishing', locked_at = now(), attempts = t.attempts + case when t.status = 'preparing' then 0 else 1 end
      from due
     where t.id = due.id
    returning t.id, t.post_id, t.sns, t.social_account_id, t.body_override, t.attempts, t.sns_container, t.preparing_since
  )
  select c.id, c.post_id, c.sns::text, c.social_account_id, a.external_id, a.status,
         coalesce(c.body_override, p.body), c.attempts, c.sns_container, c.preparing_since
    from claimed c
    join public.posts p on p.id = c.post_id
    left join public.social_accounts a on a.id = c.social_account_id;
end;
$$;

revoke execute on function public.claim_due_targets(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_due_targets(integer, uuid) to service_role;
