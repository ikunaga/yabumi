-- 毎回付けるタグ（docs/architecture.md の 4.59。2026-11-12 PM の了承）。
-- 投稿のフォーマットに「全 SNS 共通のタグ」と「SNS ごとのタグ」を持たせ、投稿では SNS ごとのタグを本文とは別に持つ（post_targets.hashtags）。
-- 送る文は「本文（SNS ごとの文面があればそれ）＋空行＋タグの行」。組み立ては post_target_text の 1 か所（TS の withHashtags と同じ結果。tests/post-hashtags.integration.test.ts）。
-- タグは # を外して持つ。1 つ 50 字まで・空白と「,」「#」なし（画面とサーバーの決まりは src/lib/sns/hashtags.ts。ここは守りの二重化）

-- ===== 投稿の SNS ごとのタグ =====
-- 5 個まで（Instagram の上限に合わせる。本文のタグと合わせた数は画面とサーバーの checkTarget で見る）
alter table public.post_targets add column hashtags text[] not null default '{}'
  check (
    cardinality(hashtags) = 0
    or (
      array_to_string(hashtags, ',', '') ~ '^[^[:space:],#＃　]{1,50}(,[^[:space:],#＃　]{1,50}){0,4}$'
      -- 区切りの「,」の数が「個数 - 1」と同じ（タグの中に「,」があると、2 つに見えて上の形をすり抜けるため）
      and cardinality(hashtags) - 1 = length(array_to_string(hashtags, ',', '')) - length(replace(array_to_string(hashtags, ',', ''), ',', ''))
    )
  );

comment on column public.post_targets.hashtags is '本文とは別に付けるタグ（# なし、5 個まで）。送るときに本文の後ろに空行をはさんで足す（post_target_text）';

-- 本人が書く列（title・body_override と同じ。RLS のポリシーはいまのまま本人の行だけ）
grant insert (hashtags) on public.post_targets to authenticated;
grant update (hashtags) on public.post_targets to authenticated;

-- ===== 投稿のフォーマットのタグ =====
-- {"all": [...], "instagram": [...]} の形。all は全 SNS 共通、SNS の名前のキーはその SNS だけ（あればこちらを使う）。それぞれ 5 個まで
alter table public.post_formats add column hashtags jsonb not null default '{}'::jsonb
  check (
    jsonb_typeof(hashtags) = 'object'
    and (hashtags - array['all', 'x', 'threads', 'instagram', 'facebook', 'tiktok', 'youtube', 'note', 'substack']) = '{}'::jsonb
    -- strict にする（lax では、配列の中身が 1 つずつ @ に入り、配列かどうかを見られない）。
    -- 2 つ目は値が配列でないと誤りになるので silent（そのときは 1 つ目が false になり、check は通らない）
    and not jsonb_path_exists(hashtags, 'strict $.* ? (@.type() != "array" || @.size() > 5)')
    and not jsonb_path_exists(hashtags, 'strict $.*[*] ? (@.type() != "string" || !(@ like_regex "^[^[:space:],#＃　]{1,50}$"))', '{}', true)
  );

comment on column public.post_formats.hashtags is '毎回付けるタグ（# なし）。all は全 SNS 共通、SNS の名前のキーはその SNS だけのタグ（あればこちらを使う）';

grant insert (hashtags) on public.post_formats to authenticated;
grant update (hashtags) on public.post_formats to authenticated;

-- ===== 送る文の組み立て（1 か所） =====
-- 本文の末尾の空白・改行を落とし、空行をはさんでタグの行（#a #b）を足す。タグがなければ本文のまま。本文が空ならタグの行だけ
create function public.post_target_text(p_text text, p_hashtags text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(cardinality(p_hashtags), 0) = 0 then p_text
    when regexp_replace(coalesce(p_text, ''), '[ \t\r\n　]+$', '') = '' then
      (select string_agg('#' || t, ' ' order by n) from unnest(p_hashtags) with ordinality as x(t, n))
    else
      regexp_replace(p_text, '[ \t\r\n　]+$', '') || E'\n\n' ||
      (select string_agg('#' || t, ' ' order by n) from unnest(p_hashtags) with ordinality as x(t, n))
  end
$$;

revoke all on function public.post_target_text(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.post_target_text(text, text[]) to service_role;

-- ===== 保存の関数に、SNS ごとのタグを足す =====
-- 20261109120000_post_text_origin の定義の写し。p_targets の各要素に hashtags（文字の配列）を足す。
-- hashtags を渡さない呼び出し（ネタ・相談・ネタ帳から下書きをつくる）は、新しい配信先は空、いまの配信先は変えない。
-- 送ったあとの配信先（status が pending でない）は、いままでどおり書きかえない（送ったタグを変えても送り直さない）
create or replace function public.save_post(
  p_post_id uuid,
  p_project_id uuid,
  p_body text,
  p_planned_at timestamptz,
  p_status text,
  p_targets jsonb,
  p_text_origin text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post_id uuid;
begin
  if p_text_origin is not null and p_text_origin not in ('self', 'ai') then
    raise exception 'invalid text origin' using errcode = '22023';
  end if;
  if p_post_id is null then
    insert into public.posts (project_id, body, planned_at, status, text_origin)
    values (p_project_id, p_body, p_planned_at, p_status, coalesce(p_text_origin, 'self'))
    returning id into v_post_id;
  else
    update public.posts
      set body = p_body, planned_at = p_planned_at, status = p_status, text_origin = coalesce(p_text_origin, text_origin)
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

  insert into public.post_targets (post_id, sns, title, body_override, social_account_id, quote_post_id, hashtags)
  select v_post_id,
         x->>'sns',
         nullif(x->>'title', ''),
         nullif(x->>'body_override', ''),
         nullif(x->>'social_account_id', '')::uuid,
         nullif(x->>'quote_post_id', ''),
         case when x ? 'hashtags' then array(select jsonb_array_elements_text(x->'hashtags')) else '{}'::text[] end
    from jsonb_array_elements(p_targets) as x
  on conflict (post_id, sns) do update
    set title = excluded.title,
        body_override = excluded.body_override,
        social_account_id = excluded.social_account_id,
        quote_post_id = excluded.quote_post_id,
        hashtags = case
          when exists (select 1 from jsonb_array_elements(p_targets) as y where y->>'sns' = excluded.sns and y ? 'hashtags') then excluded.hashtags
          else public.post_targets.hashtags
        end
    where public.post_targets.status = 'pending';

  return v_post_id;
end;
$$;

revoke all on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb, text) to authenticated;

-- ===== 送信ジョブが送る文に、タグを足す =====
-- 20261106130000_x_quote_post の定義の写し。返す body を post_target_text で組み立てる（戻り値の形と権限は変えない）
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
    returning t.id, t.post_id, t.sns, t.social_account_id, t.body_override, t.hashtags, t.attempts, t.sns_container, t.preparing_since
  )
  select c.id, c.post_id, c.sns::text, c.social_account_id, a.external_id, a.status,
         public.post_target_text(coalesce(c.body_override, p.body), c.hashtags), c.attempts, c.sns_container, c.preparing_since
    from claimed c
    join public.posts p on p.id = c.post_id
    left join public.social_accounts a on a.id = c.social_account_id;
end;
$$;

revoke execute on function public.claim_due_targets(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_due_targets(integer, uuid) to service_role;
