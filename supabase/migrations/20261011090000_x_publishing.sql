-- X への自動投稿（docs/architecture.md の 4.13、決定 D16）。
-- X の API は使った分だけ払う方式なので、払う額を記録して月の上限を守る。
-- X のリフレッシュトークンは使い捨てなので、延長が同時に 2 回走らないようにする。

-- ===== SNS の API に払う費用 =====
-- 書き込みはサーバー（secret キー）だけ。利用者が記録を消して上限をすり抜けられないようにする（ai_usage と同じ考え方）
create table public.sns_api_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  sns public.sns_key not null,
  -- 投稿のときはその配信先。投稿を消しても費用の記録は残す
  post_target_id uuid references public.post_targets (id) on delete set null,
  -- post: URL なしの投稿 / post_with_url: 本文に URL がある投稿 / user_read: つなぐときにユーザーを読む
  operation text not null check (operation in ('post', 'post_with_url', 'user_read')),
  cost_usd numeric(10, 6) not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

comment on table public.sns_api_usage is 'SNS の API に払った（払う見込みの）費用。月の上限の判定に使う。サーバーのみが書く';

create index sns_api_usage_sns_idx on public.sns_api_usage (sns, created_at);
create index sns_api_usage_owner_idx on public.sns_api_usage (owner_id, created_at);
create index sns_api_usage_target_idx on public.sns_api_usage (post_target_id);

alter table public.sns_api_usage enable row level security;
create policy "sns_api_usage_select_own" on public.sns_api_usage
  for select to authenticated using ((select auth.uid()) = owner_id);
-- 追加・変更・削除のポリシーは置かない（利用者からは書けない）

-- 費用を先に記録してから API を呼ぶ。月（日本時間）の合計が上限を超えるなら記録せず null を返す。
-- 同じ SNS の記録はアドバイザリロックで順に行うので、ジョブと「今すぐ送る」が重なっても上限を超えない。
-- p_budget が null のときは上限を見ない（つなぐときのユーザーの読み取りなど、止めると困るもの）
create function public.reserve_sns_spend(
  p_owner_id uuid,
  p_sns public.sns_key,
  p_post_target_id uuid,
  p_operation text,
  p_cost_usd numeric,
  p_budget_usd numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_spent numeric;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('sns_api_usage:' || p_sns::text));
  if p_budget_usd is not null then
    select coalesce(sum(cost_usd), 0) into v_spent
      from public.sns_api_usage
     where sns = p_sns and created_at >= v_month_start;
    if v_spent + p_cost_usd > p_budget_usd then
      return null;
    end if;
  end if;
  insert into public.sns_api_usage (owner_id, sns, post_target_id, operation, cost_usd)
  values (p_owner_id, p_sns, p_post_target_id, p_operation, p_cost_usd)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric) to service_role;

-- 今月（日本時間）に SNS へ払った額の合計。画面に「今月の X の費用」を出すのに使う（全員分なのでサーバーだけ）
create function public.sns_spend_this_month(p_sns public.sns_key)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0)
    from public.sns_api_usage
   where sns = p_sns
     and created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
$$;

revoke execute on function public.sns_spend_this_month(public.sns_key) from public, anon, authenticated;
grant execute on function public.sns_spend_this_month(public.sns_key) to service_role;

-- ===== トークンの延長を 1 回だけにする =====
-- X のリフレッシュトークンは使うたびに新しくなり、古いものは使えなくなる。
-- 2 か所で同時に延長すると片方が失効させてしまうので、延長する人は先にこの行を「延長中」にする
alter table public.social_account_tokens add column refresh_locked_until timestamptz;

comment on column public.social_account_tokens.refresh_locked_until is 'トークンを延長中なら、その期限。期限を過ぎたロックは取り直せる（延長の途中で落ちた場合）';

-- 延長の権利を取る。取れたら今のトークン（暗号文）を返し、ほかの人が持っていれば何も返さない
create function public.claim_token_refresh(p_social_account_id uuid, p_lease_seconds integer default 30)
returns table (access_token_encrypted text, refresh_token_encrypted text, expires_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  update public.social_account_tokens t
     set refresh_locked_until = now() + make_interval(secs => p_lease_seconds)
   where t.social_account_id = p_social_account_id
     and (t.refresh_locked_until is null or t.refresh_locked_until < now())
  returning t.access_token_encrypted, t.refresh_token_encrypted, t.expires_at;
$$;

revoke execute on function public.claim_token_refresh(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_token_refresh(uuid, integer) to service_role;

-- ===== 送れなかった X の投稿を、手で投稿して記録できるようにする =====
-- 月の上限やクレジット切れで送れなかった X の配信先は、利用者が手で投稿し、URL を記録できる（決定 D16）
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
     set status = 'published', published_at = now(), external_url = nullif(p_url, ''), error_message = null
   where t.id = p_target_id
     and t.owner_id = (select auth.uid())
     and (
       (public.is_manual_sns(t.sns) and t.status in ('pending', 'failed'))
       or (t.sns = 'x' and t.status = 'failed')
     );
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
end;
$$;
