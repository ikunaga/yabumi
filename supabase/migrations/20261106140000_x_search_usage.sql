-- X の人気の投稿を yabumi の中で探す（A 案。docs/architecture.md の 4.52、feat/x-buzz-search。2026-11-06 オーナーの決定）の回数と費用の記録。
-- X の recent search を yabumi のアプリの鍵で呼ぶ。1 回で読むのは直近 7 日の投稿 10 件と、その書いた人（最大 10 人）なので、
-- 1 回の最大の額は 10 × $0.005 + 10 × $0.010 = $0.15。呼ぶ前にこの額で予約し、返ってきた件数と人数で実際の額に直す（アプリ。src/lib/sns/x/search.ts）。
--
-- 上限（関数の中で固定。アプリや利用者からは変えられない）:
-- - 1 人 月 3 回。登録して 7 日までは月 1 回
-- - yabumi 全体で月 $1。X の投稿の上限（sns_api_usage、既定 $3）とは別の表で数えるので、探しすぎても自動投稿は止まらない
-- 断った分は数えない（行を作らない）。呼び出しに失敗したら、請求されないとはっきりしているとき（4xx）だけアプリが行を消し、
-- それ以外（5xx・タイムアウトなど）は予約の額のまま failed にする（AI の予約、20261103170000 の M3 と同じ考え）。
--
-- 他人の投稿は保存しない。検索の言葉も残さない（docs/legal.md）。残すのは回数・額・件数だけ
-- 退会・プロジェクトの削除では消さずに、紐づけだけを外す（owner_id・project_id を null に。全体の $1 の合計から消えないよう、ai_usage と同じ）。
-- 保存期間は ai_usage・sns_api_usage と同じ 13 か月（purge_expired_data に足す。docs/architecture.md の 4.14）

create table public.x_search_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  -- reserved: 予約した（呼んでいる）/ done: 実際の額に直した / failed: 請求されたかわからない失敗（予約の額のまま数える）
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  cost_usd numeric not null check (cost_usd >= 0 and cost_usd <= 0.15),
  post_count integer check (post_count is null or post_count between 0 and 10),
  user_count integer check (user_count is null or user_count between 0 and 10),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

comment on table public.x_search_usage is 'X の人気の投稿を探した回数と費用（4.52）。検索の言葉と投稿は残さない';

create index x_search_usage_owner_created_idx on public.x_search_usage (owner_id, created_at);
create index x_search_usage_created_idx on public.x_search_usage (created_at);

-- サーバーだけが読み書きする（利用者には残りの回数だけを x_search_quota で渡す）。RLS を有効にし、ポリシーは作らない
alter table public.x_search_usage enable row level security;

revoke all on table public.x_search_usage from public, anon, authenticated;
grant all on table public.x_search_usage to service_role;

-- 残りの回数（ロックは取らない。画面の表示用）と、予約（reserve_x_search の中でロックを取ってから呼ぶ）の共通の判定。
-- status: ok / user_limit（今月 3 回を使った）/ new_user_limit（登録 7 日までの 1 回を使った）/ global_limit（yabumi 全体の $1）
-- resets_on: 次に探せるようになる日（日本時間）。新しい人は 7 日たった日（その月の中なら）、それ以外は来月 1 日
-- p_scope_owner: 全体の上限を数える範囲（テスト用。値を入れると、その利用者と p_owner_id の記録だけを数える）
create function public.x_search_quota(p_owner_id uuid, p_scope_owner uuid default null, p_as_of timestamptz default null)
returns table (status text, used integer, limit_count integer, resets_on date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_user_monthly constant integer := 3;
  c_new_user_monthly constant integer := 1;
  c_new_days constant interval := interval '7 days';
  c_global_monthly_usd constant numeric := 1;
  c_cost_usd constant numeric := 0.15;
  v_now timestamptz := coalesce(p_as_of, now());
  v_month_start timestamptz := date_trunc('month', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  v_next_month date := (date_trunc('month', v_now at time zone 'Asia/Tokyo') + interval '1 month')::date;
  v_created timestamptz;
  v_new_until timestamptz;
  v_limit integer;
  v_used integer;
  v_global numeric;
begin
  select u.created_at into v_created from auth.users u where u.id = p_owner_id;
  if v_created is null then
    raise exception 'unknown user' using errcode = '22023';
  end if;
  v_new_until := v_created + c_new_days;
  v_limit := case when v_new_until > v_now then c_new_user_monthly else c_user_monthly end;

  select count(*)::integer into v_used
    from public.x_search_usage x
   where x.owner_id = p_owner_id and x.created_at >= v_month_start;
  select coalesce(sum(x.cost_usd), 0) into v_global
    from public.x_search_usage x
   where x.created_at >= v_month_start
     and (p_scope_owner is null or x.owner_id in (p_scope_owner, p_owner_id));

  if v_used >= v_limit then
    -- 新しい人は、7 日たてば月 3 回になる（その月の中なら、その日から）
    if v_limit = c_new_user_monthly and v_used < c_user_monthly and (v_new_until at time zone 'Asia/Tokyo')::date < v_next_month then
      return query select 'new_user_limit'::text, v_used, v_limit, (v_new_until at time zone 'Asia/Tokyo')::date;
    else
      return query select 'user_limit'::text, v_used, v_limit, v_next_month;
    end if;
  elsif v_global + c_cost_usd > c_global_monthly_usd then
    return query select 'global_limit'::text, v_used, v_limit, v_next_month;
  else
    return query select 'ok'::text, v_used, v_limit, null::date;
  end if;
end;
$$;

revoke all on function public.x_search_quota(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.x_search_quota(uuid, uuid, timestamptz) to service_role;

-- 予約する。同時に押しても上限を超えないよう、ロックの中で判定してから行を作る。通らなければ行を作らずに理由を返す（usage_id は null）
create function public.reserve_x_search(p_owner_id uuid, p_project_id uuid, p_scope_owner uuid default null, p_as_of timestamptz default null)
returns table (usage_id uuid, status text, used integer, limit_count integer, resets_on date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cost_usd constant numeric := 0.15;
  q record;
  v_id uuid;
begin
  if p_owner_id is null then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  -- プロジェクトは本人のものだけ（アプリでも RLS で確かめるが、記録に他人のプロジェクトを付けない）
  if p_project_id is not null and not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = p_owner_id) then
    raise exception 'invalid reservation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('x_search_usage'));
  select * into q from public.x_search_quota(p_owner_id, p_scope_owner, p_as_of);
  if q.status <> 'ok' then
    return query select null::uuid, q.status, q.used, q.limit_count, q.resets_on;
    return;
  end if;
  insert into public.x_search_usage (owner_id, project_id, cost_usd, created_at)
  values (p_owner_id, p_project_id, c_cost_usd, coalesce(p_as_of, now()))
  returning id into v_id;
  return query select v_id, 'ok'::text, q.used + 1, q.limit_count, null::date;
end;
$$;

revoke all on function public.reserve_x_search(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_x_search(uuid, uuid, uuid, timestamptz) to service_role;

-- 期限を過ぎたデータを消す（いちばん新しい定義 20261102230100 に、x_search_usage の 13 か月の 1 行だけを足す）
create or replace function public.purge_expired_data()
returns table (ai_threads_deleted integer, ai_usage_deleted integer, sns_api_usage_deleted integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threads integer;
  v_ai_usage integer;
  v_sns_usage integer;
begin
  delete from public.ai_threads where updated_at < now() - interval '1 year';
  get diagnostics v_threads = row_count;
  delete from public.ai_usage where created_at < now() - interval '13 months';
  get diagnostics v_ai_usage = row_count;
  delete from public.sns_api_usage where created_at < now() - interval '13 months';
  get diagnostics v_sns_usage = row_count;
  delete from public.ai_image_jobs where created_at < now() - interval '13 months';
  delete from public.x_search_usage where created_at < now() - interval '13 months';
  delete from public.pending_page_choices where expires_at < now();
  delete from public.link_clicks where clicked_at < now() - interval '90 days';
  delete from public.link_hash_salts where day < (now() at time zone 'Asia/Tokyo')::date - 1;
  delete from public.play_account_creations where created_at < now() - interval '30 days';
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;
