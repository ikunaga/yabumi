-- 「テストで 1 本つくる」（見本）の 1 日 5 回を、AI を呼ぶかどうかに関わらず、見本を 1 本つくるごとに数える
-- （2026-11-21 のセキュリティ確認の M1。2026-11-22 オーナーの了承）。
-- 前は AI の予約（reserve_ai_usage の auto_post_sample）の数で数えていたので、次の見本が数えられなかった:
-- - シリーズのフォーマット: 文は型に入れるので auto_post_sample の予約がない（次の回の案は auto_post で予約し、本番の 1 日 10 回も食っていた）
-- - 同じ材料で作り直す（シリーズ）: AI はチェック（auto_post_check）だけ
-- どちらも見本のたびに画像を 1 枚つくるので、画像の月の枠まで使い切れた。
-- 見本をつくる前に reserve_auto_sample で 1 回分を取る。断ったら AI も画像も呼ばない。
-- 預かるのは利用者の ID と日時だけで、2 日で消す（AI の利用量の記録より短い。プライバシーポリシーの「利用量と費用」・上限を数える使い道の中。docs/legal.md）。
-- reserve_ai_usage の auto_post_sample の 5 回（AI の予約の数）は、念のための上限としてそのまま残す。

create table public.auto_sample_runs (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.auto_sample_runs is '見本（テストで 1 本つくる）を始めた記録。1 人 1 日 5 回の数え方だけに使う。サーバーだけが読み書きし、2 日たったら消す（reserve_auto_sample と自動の投稿のジョブの片付け）。退会したらすぐ消える';
create index auto_sample_runs_owner_idx on public.auto_sample_runs (owner_id, created_at);
create index auto_sample_runs_created_idx on public.auto_sample_runs (created_at);
alter table public.auto_sample_runs enable row level security;
-- 利用者のポリシー・grant は作らない（足すのは reserve_auto_sample だけ。サーバーは読むのと消すのだけ）
revoke all on public.auto_sample_runs from public, anon, authenticated;
grant select, delete on public.auto_sample_runs to service_role;

-- 見本を 1 本つくる前に呼ぶ。'ok'（1 回分を記録した）・'auto_sample_limit'（今日はもう 5 回）・'auto_post_hold'（運営者が止めている）。
-- 同じ人が同時に押しても超えないように、人ごとの lock の中で数えて足す。回数は関数の中で固定（src/lib/auto-post/schema.ts の AUTO_SAMPLE_DAILY_RUNS と同じ値）
create function public.reserve_auto_sample(p_owner_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_daily_runs constant integer := 5;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
begin
  if p_owner_id is null then
    raise exception 'owner required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('auto_sample_runs'), hashtext(p_owner_id::text));
  -- 行が増え続けないように、その人の 2 日より前の行はここで消す（使わなくなった人の分は、自動の投稿のジョブの片付けで消す）
  delete from public.auto_sample_runs r where r.owner_id = p_owner_id and r.created_at < now() - interval '2 days';
  if public.auto_post_held(p_owner_id) then
    return 'auto_post_hold';
  end if;
  if (select count(*) from public.auto_sample_runs r where r.owner_id = p_owner_id and r.created_at >= v_day_start) >= c_daily_runs then
    return 'auto_sample_limit';
  end if;
  insert into public.auto_sample_runs (owner_id) values (p_owner_id);
  return 'ok';
end;
$$;
comment on function public.reserve_auto_sample(uuid) is '見本（テストで 1 本つくる）を始める前に、1 人 1 日 5 回（日本時間）を数えて 1 回分を記録する。運営者が自動の投稿を止めている人は断る。サーバー（service_role）だけが呼ぶ';
revoke all on function public.reserve_auto_sample(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reserve_auto_sample(uuid) to service_role;
