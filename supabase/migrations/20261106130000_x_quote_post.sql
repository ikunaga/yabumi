-- X の人気の投稿を引用して投稿をつくる（2026-11-06 オーナーと決めた B 案。docs/architecture.md の 4.52）。
-- X の API の引用（quote_tweet_id）は、2026-04-20 から使った分だけ払う方式（self-serve）では使えない（https://docs.x.com/changelog の 2026-04-16）。
-- そのため引用の投稿は、yabumi が X の投稿画面（x.com/intent/post）を開き、利用者が X の画面で送る。yabumi には X の下書きとして残し、
-- 送ったあとに「投稿した」で記録する（手で投稿する SNS と同じ形）。

-- ===== 引用する投稿の id =====
-- 本人が書く列（title・body_override と同じ。RLS のポリシーはいまのまま）。形は X の投稿の id（数字だけ、19 桁まで）で、X の配信先だけ
alter table public.post_targets add column quote_post_id text
  check (quote_post_id is null or (sns = 'x' and quote_post_id ~ '^[1-9][0-9]{0,18}$'));
comment on column public.post_targets.quote_post_id is '引用する X の投稿の id。ある配信先は送信ジョブが拾わず、利用者が X の画面で送って記録する。記録したら消す';
grant insert (quote_post_id) on public.post_targets to authenticated;
grant update (quote_post_id) on public.post_targets to authenticated;

-- ===== save_post に quote_post_id を足す（p_targets: [{"sns": "x", "quote_post_id": "123...", ...}]）=====
-- 前の呼び方（quote_post_id のキーなし）は null になる。引数と権限（authenticated だけ。20261011220100_explicit_grants）は変えない
create or replace function public.save_post(
  p_post_id uuid,
  p_project_id uuid,
  p_body text,
  p_planned_at timestamptz,
  p_status text,
  p_targets jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post_id uuid;
begin
  if p_post_id is null then
    insert into public.posts (project_id, body, planned_at, status)
    values (p_project_id, p_body, p_planned_at, p_status)
    returning id into v_post_id;
  else
    update public.posts
      set body = p_body, planned_at = p_planned_at, status = p_status
      where id = p_post_id and project_id = p_project_id
      returning id into v_post_id;
    if v_post_id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
  end if;

  -- 外された SNS の配信先を消す（送信済みのものは残す）
  delete from public.post_targets t
    where t.post_id = v_post_id
      and t.status = 'pending'
      and t.sns not in (select x->>'sns' from jsonb_array_elements(p_targets) as x);

  insert into public.post_targets (post_id, sns, title, body_override, social_account_id, quote_post_id)
  select v_post_id,
         x->>'sns',
         nullif(x->>'title', ''),
         nullif(x->>'body_override', ''),
         nullif(x->>'social_account_id', '')::uuid,
         nullif(x->>'quote_post_id', '')
    from jsonb_array_elements(p_targets) as x
  on conflict (post_id, sns) do update
    set title = excluded.title,
        body_override = excluded.body_override,
        social_account_id = excluded.social_account_id,
        quote_post_id = excluded.quote_post_id
    where public.post_targets.status = 'pending';

  return v_post_id;
end;
$$;

-- ===== 引用の X の配信先も「投稿した」で記録できるようにする =====
-- 利用者が X の画面で送ったあとに記録する。記録したら、引用した他人の投稿の id は持たない（使い終わった X の情報を持ち続けない。4.19）
-- 引数と権限（authenticated だけ。20261004180000_manual_channels）は変えない
create or replace function public.mark_manual_target_posted(p_target_id uuid, p_url text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_url is not null and p_url <> '' and (p_url !~ '^https://' or char_length(p_url) > 2000) then
    raise exception 'invalid url' using errcode = '22023';
  end if;
  update public.post_targets t
     set status = 'published', published_at = now(), external_url = nullif(p_url, ''), error_message = null, quote_post_id = null
   where t.id = p_target_id
     and t.owner_id = (select auth.uid())
     and (
       (public.is_manual_sns(t.sns) and t.status in ('pending', 'failed'))
       or (t.sns = 'x' and t.status = 'failed')
       or (t.sns = 'x' and t.status = 'pending' and t.quote_post_id is not null)
     );
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ===== 送信ジョブは、引用の配信先を拾わない =====
-- 画面とサーバー（savePost）でも予約・今すぐ送るにできないようにしている。ここは守りの二重化。戻り値（20261011280000_publish_preparing）と権限（service_role だけ）は変えない
create or replace function public.claim_due_targets(p_limit integer default 10, p_post_id uuid default null)
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
       and t.quote_post_id is null
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
