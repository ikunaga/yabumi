-- TikTok の連携（docs/design/tiktok.md）。段 2 の写真を渡す入口の表と、段 3 の送るときの同意の記録の表。
-- どちらもサーバーの権限だけが読み書きする（利用者の権限には grant しない。RLS は有効にし、ポリシーは置かない）

-- 写真を渡す入口（https://yabumi.app/tiktok-media/<トークン>.jpg）のトークン（docs/design/tiktok.md の 2.）。
-- トークンそのものは持たず、SHA-256 だけを持つ。誰の・どの配信先の・どの画像かを結びつけ、1 時間で切れる。送り終えたらその場で消す
create table public.tiktok_media_tickets (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  post_target_id uuid not null references public.post_targets (id) on delete cascade,
  media_id uuid not null references public.media_files (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index tiktok_media_tickets_target_idx on public.tiktok_media_tickets (post_target_id);
create index tiktok_media_tickets_expires_idx on public.tiktok_media_tickets (expires_at);
alter table public.tiktok_media_tickets enable row level security;
revoke all on public.tiktok_media_tickets from anon, authenticated;
-- サーバー（service_role）が読み書きする。既定でも付くが、明示しておく（20261011220100_explicit_grants）
grant select, insert, delete on public.tiktok_media_tickets to service_role;

-- TikTok に送るときに利用者が選んで同意した設定（docs/design/tiktok.md の 3. と 4.）。配信先ごとに 1 行。
-- 予約のときは、送る直前にこの記録と creator_info を照らす。同意の時刻・文の指紋・AI の印はサーバーが決める
create table public.post_target_tiktok (
  post_target_id uuid primary key references public.post_targets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  privacy_level text not null check (privacy_level in ('PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY')),
  disable_comment boolean not null default true,
  brand_organic boolean not null default false,
  brand_content boolean not null default false,
  post_mode text not null default 'DIRECT_POST' check (post_mode in ('DIRECT_POST', 'MEDIA_UPLOAD')),
  is_aigc boolean not null default false,
  consented_at timestamptz not null,
  -- 同意したときのタイトルと説明の指紋（SHA-256）。送る直前の文と違えば送らない
  consent_text_hash text not null check (consent_text_hash ~ '^[0-9a-f]{64}$'),
  consent_nickname text not null check (char_length(consent_nickname) <= 100),
  consent_username text not null default '' check (char_length(consent_username) <= 100),
  updated_at timestamptz not null default now(),
  -- ブランドコンテンツは「自分だけ」にできない（TikTok の決まり）
  constraint post_target_tiktok_branded_not_private check (not (brand_content and privacy_level = 'SELF_ONLY'))
);
alter table public.post_target_tiktok enable row level security;
revoke all on public.post_target_tiktok from anon, authenticated;
grant select, insert, update, delete on public.post_target_tiktok to service_role;

-- 持ち主をそろえる（サーバーの確かめが漏れても、ほかの人の配信先・画像を結びつけない）
create function public.tiktok_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.post_targets t where t.id = new.post_target_id and t.owner_id = new.owner_id and t.sns = 'tiktok') then
    raise exception 'post_target must be the owner''s TikTok target' using errcode = '23514';
  end if;
  -- 画像の確かめは入口の表だけ（if を分ける。同意の表の new には media_id がないので、同じ式に書くと読み込みで止まる）
  if tg_table_name = 'tiktok_media_tickets' then
    if not exists (select 1 from public.media_files m where m.id = new.media_id and m.owner_id = new.owner_id) then
      raise exception 'media must be the owner''s' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tiktok_check_owner() from public, anon, authenticated, service_role;

create trigger tiktok_media_tickets_check_owner before insert or update on public.tiktok_media_tickets
  for each row execute function public.tiktok_check_owner();
create trigger post_target_tiktok_check_owner before insert or update on public.post_target_tiktok
  for each row execute function public.tiktok_check_owner();
