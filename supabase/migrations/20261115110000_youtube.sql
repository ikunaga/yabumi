-- YouTube の連携（docs/design/youtube.md。2026-11-15 オーナーが Y1〜Y7 をおすすめで了承。PM の依頼）。
-- 1. post_target_youtube: 送るときに利用者が選んで同意した設定（8.）。post_target_tiktok と同じ作り（サーバーの権限だけが読み書きする）
-- 2. youtube_uploads: 再開できるアップロードの途中の情報（3.・8.）。サーバーだけ
-- 3. reserve_youtube_upload: 1 日のアップロードの数（プロジェクト全体と利用者ごと）を数えて 1 本ぶん取る（6.）。記録は sns_api_usage
-- 4. 「YouTube は手で投稿する」（12.。Y4）: by_hand_message と mark_manual_target_posted に YouTube を足す
-- 持ち主をそろえるトリガーは、tiktok_check_owner（TikTok の配信先・画像の確かめ）を広げず、YouTube 用を別に置く（TikTok の関数を変えると、TikTok の表の確かめにも響くため）

-- ===== 1. 送るときの設定と同意（配信先ごとに 1 行） =====
create table public.post_target_youtube (
  post_target_id uuid primary key references public.post_targets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  privacy_status text not null check (privacy_status in ('public', 'unlisted', 'private')),
  -- 子ども向けか（selfDeclaredMadeForKids）。初めの値を置かない（選ぶまで保存しない。COPPA）
  made_for_kids boolean not null,
  -- 本物と見分けにくい改変・合成の申告（status.containsSyntheticMedia）
  synthetic_media boolean not null default false,
  category_id text not null check (category_id ~ '^[0-9]{1,3}$'),
  consented_at timestamptz not null,
  -- 同意したときのタイトルと説明の指紋（SHA-256）。送る直前の文と違えば送らない
  consent_text_hash text not null check (consent_text_hash ~ '^[0-9a-f]{64}$'),
  -- 同意したときのチャンネル名。送る直前に読み直したチャンネルと違えば送らない
  consent_channel text not null check (char_length(consent_channel) <= 100),
  updated_at timestamptz not null default now()
);
comment on table public.post_target_youtube is 'YouTube に送るときに利用者が選んで同意した設定（docs/design/youtube.md の 8.）。サーバーの権限だけが読み書きする';
alter table public.post_target_youtube enable row level security;
revoke all on public.post_target_youtube from anon, authenticated;
grant select, insert, update, delete on public.post_target_youtube to service_role;

-- ===== 2. アップロードの途中の情報 =====
create table public.youtube_uploads (
  post_target_id uuid primary key references public.post_targets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 再開できるアップロードのセッションの URL（暗号化。それだけで続きを送れるおそれがあるため）
  session_uri_encrypted text,
  bytes_total bigint not null check (bytes_total > 0),
  bytes_sent bigint not null default 0 check (bytes_sent >= 0 and bytes_sent <= bytes_total),
  -- アップロードが済んだら入る（これより後は二度と上げ直さない）
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{6,32}$'),
  -- 送ったあとの処理の確かめをこの時刻まで続ける（null は確かめない）
  processing_check_until timestamptz,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.youtube_uploads is 'YouTube の再開できるアップロードの途中の情報（docs/design/youtube.md の 3.）。サーバーだけ';
alter table public.youtube_uploads enable row level security;
revoke all on public.youtube_uploads from anon, authenticated;
grant select, insert, update, delete on public.youtube_uploads to service_role;

-- 持ち主をそろえる（サーバーの確かめが漏れても、ほかの人の配信先・YouTube でない配信先に結びつけない）
create function public.youtube_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.post_targets t where t.id = new.post_target_id and t.owner_id = new.owner_id and t.sns = 'youtube') then
    raise exception 'post_target must be the owner''s YouTube target' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.youtube_check_owner() from public, anon, authenticated, service_role;

create trigger post_target_youtube_check_owner before insert or update on public.post_target_youtube
  for each row execute function public.youtube_check_owner();
create trigger youtube_uploads_check_owner before insert or update on public.youtube_uploads
  for each row execute function public.youtube_check_owner();

-- ===== 3. 1 日のアップロードの数 =====
alter table public.sns_api_usage drop constraint sns_api_usage_operation_check;
alter table public.sns_api_usage add constraint sns_api_usage_operation_check
  check (operation in ('post', 'post_with_url', 'user_read', 'post_read', 'metrics_read', 'followers_read', 'upload'));

-- videos.insert の割り当ては、プロジェクト全体で 1 日 100 回（太平洋時間の 0 時に戻る）。yabumi の中で数える（Google に残りを聞く手段がない）。
-- 全体が p_global_limit、利用者ごとが p_user_limit を超えるなら記録せず、どちらに当たったかを返す。取れたら 'ok'。
-- アドバイザリロックで順に行うので、同時に何本送っても超えない（reserve_sns_spend と同じ考え方）
create function public.reserve_youtube_upload(
  p_owner_id uuid,
  p_post_target_id uuid,
  p_global_limit integer,
  p_user_limit integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  v_all integer;
  v_mine integer;
begin
  if p_owner_id is null or p_global_limit is null or p_user_limit is null then
    raise exception 'owner and limits are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('youtube_upload_quota'));
  select count(*), count(*) filter (where owner_id = p_owner_id) into v_all, v_mine
    from public.sns_api_usage
   where sns = 'youtube' and operation = 'upload' and created_at >= v_day_start;
  if v_all >= p_global_limit then
    return 'global';
  end if;
  if v_mine >= p_user_limit then
    return 'user';
  end if;
  insert into public.sns_api_usage (owner_id, sns, post_target_id, operation, cost_usd)
  values (p_owner_id, 'youtube', p_post_target_id, 'upload', 0);
  return 'ok';
end;
$$;
comment on function public.reserve_youtube_upload(uuid, uuid, integer, integer) is 'YouTube のアップロード 1 本ぶんを取る（太平洋時間の 1 日。全体と利用者ごとの上限）。ok / global / user を返す。サーバーだけ';
revoke all on function public.reserve_youtube_upload(uuid, uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_youtube_upload(uuid, uuid, integer, integer) to service_role;

-- ===== 4. 「YouTube は手で投稿する」 =====
create or replace function public.by_hand_message(p_sns text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_sns
    when 'x' then 'X は手で投稿することにしたので、自動では送りません。下の「X に手で投稿する」から投稿して記録できます。'
    when 'tiktok' then 'TikTok は手で投稿することにしたので、自動では送りません。下の「TikTok に手で投稿する」から投稿して記録できます。'
    when 'youtube' then 'YouTube は手で投稿することにしたので、自動では送りません。下の「YouTube に手で投稿する」から投稿して記録できます。'
  end
$$;
revoke all on function public.by_hand_message(text) from public, anon, authenticated, service_role;

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
       or (t.sns in ('x', 'tiktok', 'youtube') and t.status = 'failed')
       or (t.sns = 'x' and t.status = 'pending' and t.quote_post_id is not null)
     );
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
end;
$$;
