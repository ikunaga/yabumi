-- X の規約への対応（docs/architecture.md の 4.13「規約で求められること」）と、費用の上限を数える範囲。
-- X の開発者規約は、X 側で消された投稿の情報を、アプリ側でも最新に保つ（消す）ことを求めている。
-- 矢書が持つ X の情報は、矢書から送った投稿の ID と URL だけ（本文は利用者が書いたもの）なので、それを最新に保つ。

-- ===== SNS 上の投稿の状態 =====
-- sns_checked_at: SNS に投稿がまだあることを最後に確かめた日時（同じ投稿を 24 時間に 2 回は確かめない。読むのが有料のため）
-- sns_removed_at: 矢書の外（SNS の画面など）で消されていたとわかった日時。矢書から取り消したときは入らない
alter table public.post_targets add column sns_checked_at timestamptz;
alter table public.post_targets add column sns_removed_at timestamptz;

comment on column public.post_targets.sns_checked_at is 'SNS に投稿がまだあることを最後に確かめた日時';
comment on column public.post_targets.sns_removed_at is '矢書の外で SNS の投稿が消されていたとわかった日時（X が消えた投稿を確かめた、または利用者が「SNS で消した」と記録した）';

-- 取り消し済みになったら、SNS の投稿の ID と URL を残さない（消えた投稿の情報を持ち続けないため）
create function public.clear_removed_target_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'deleted' then
    new.external_post_id := null;
    new.external_url := null;
  end if;
  return new;
end;
$$;

create trigger post_targets_clear_removed_refs
  before insert or update of status, external_post_id, external_url on public.post_targets
  for each row execute function public.clear_removed_target_refs();

-- これまでに取り消したものも消す
update public.post_targets set external_post_id = null, external_url = null
 where status = 'deleted' and (external_post_id is not null or external_url is not null);

-- ===== 投稿を読む費用 =====
-- post_read: SNS に投稿がまだあるかを確かめる読み取り（X は 1 件 $0.005）
alter table public.sns_api_usage drop constraint sns_api_usage_operation_check;
alter table public.sns_api_usage add constraint sns_api_usage_operation_check
  check (operation in ('post', 'post_with_url', 'user_read', 'post_read'));

-- ===== 上限を数える範囲 =====
-- p_scope_owner が null なら、これまでどおり矢書全体の今月の合計で上限を判定する（本番はこれ）。
-- 値を入れると、その利用者の記録だけを数える（テストで、同じ DB を使う他のテストに左右されないため。利用者ごとの上限にも使える）
drop function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric);

create function public.reserve_sns_spend(
  p_owner_id uuid,
  p_sns public.sns_key,
  p_post_target_id uuid,
  p_operation text,
  p_cost_usd numeric,
  p_budget_usd numeric,
  p_scope_owner uuid default null
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
     where sns = p_sns
       and created_at >= v_month_start
       and (p_scope_owner is null or owner_id = p_scope_owner);
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

revoke execute on function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric, uuid) from public, anon, authenticated;
grant execute on function public.reserve_sns_spend(uuid, public.sns_key, uuid, text, numeric, numeric, uuid) to service_role;
