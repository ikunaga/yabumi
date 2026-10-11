-- 短縮リンクとクリックの記録（F07、決定 D20）。方針は docs/architecture.md の 4.22
-- 矢書が発行する短いリンク（go.yabumi.app/<code>、切り替えの前は <APP_URL>/go/<code>）を押すと、記録してから行き先（ストアなど）へ転送する。
-- 1 クリックの記録（link_clicks）は 90 日で消し、日ごとの集計（link_click_daily）を残す。生の IP アドレスは残さず、
-- 「その日だけの秘密 + IP + User-Agent」のハッシュだけを残す（秘密は翌日に消すので、日をまたいで同じ人とはわからない）。
-- 書き込みはサーバー（service_role）だけ。利用者は自分のリンクと日ごとの集計を読めるだけ。

-- ===== App Store のキャンペーンリンクの provider token（pt）。利用者が App Store Connect で一度だけ確かめて入れる =====
alter table public.projects
  add column app_store_provider_token text check (app_store_provider_token is null or app_store_provider_token ~ '^[0-9]{1,20}$');
-- projects の更新の権限は、すでに authenticated に与えてある（20261011220100）。列を足しても同じ権限が効く

-- ===== 短縮リンク =====
create table public.short_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Za-z0-9]{6,12}$'),
  destination_url text not null check (destination_url ~ '^https://' and char_length(destination_url) <= 2000),
  -- どの SNS で使うリンクか（数字を SNS ごとに分けるため）。どれでもないリンクは空
  sns public.sns_key,
  -- post: 投稿の本文の URL を置き換えたもの / profile: SNS のプロフィールに置くもの / custom: 利用者が自由に作ったもの
  kind text not null check (kind in ('post', 'profile', 'custom')),
  -- 投稿の配信先（kind = post のとき）。配信先を消しても、送った投稿の中のリンクは生かすので空にするだけ
  post_target_id uuid references public.post_targets (id) on delete set null,
  label text not null default '' check (char_length(label) <= 100),
  -- 止めたリンクは転送せず、「このリンクは使われていません」を出す
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_target_id, destination_url)
);

create index short_links_project_idx on public.short_links (project_id, created_at desc);
create index short_links_owner_idx on public.short_links (owner_id);

create trigger short_links_set_updated_at
  before update on public.short_links
  for each row execute function public.set_updated_at();

alter table public.short_links enable row level security;
create policy "short_links_select_own" on public.short_links
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.short_links from anon, authenticated;
grant select on public.short_links to authenticated;

-- ===== 1 クリックの記録（サーバーだけ。90 日で消す） =====
create table public.link_clicks (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.short_links (id) on delete cascade,
  clicked_at timestamptz not null default now(),
  device text not null check (device in ('ios', 'android', 'desktop', 'other')),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  visitor_hash text not null,
  -- 数えなかった理由。空なら数えた
  excluded text check (excluded is null or excluded in ('bot', 'prefetch', 'duplicate'))
);

create index link_clicks_dedupe_idx on public.link_clicks (link_id, visitor_hash, clicked_at desc);
create index link_clicks_clicked_at_idx on public.link_clicks (clicked_at);

alter table public.link_clicks enable row level security;
revoke all on public.link_clicks from anon, authenticated;

-- ===== 日ごと（日本時間）・端末ごとの集計（利用者は自分のものを読める） =====
create table public.link_click_daily (
  link_id uuid not null references public.short_links (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  device text not null check (device in ('ios', 'android', 'desktop', 'other')),
  clicks integer not null default 0 check (clicks >= 0),
  excluded integer not null default 0 check (excluded >= 0),
  primary key (link_id, day, device)
);

create index link_click_daily_owner_idx on public.link_click_daily (owner_id, day);

alter table public.link_click_daily enable row level security;
create policy "link_click_daily_select_own" on public.link_click_daily
  for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.link_click_daily from anon, authenticated;
grant select on public.link_click_daily to authenticated;

-- ===== その日だけの秘密（ハッシュの塩）。翌日に消す（サーバーだけ） =====
create table public.link_hash_salts (
  day date primary key,
  salt bytea not null
);

alter table public.link_hash_salts enable row level security;
revoke all on public.link_hash_salts from anon, authenticated;

-- ===== クリックを記録する（サーバーだけが呼ぶ） =====
-- IP と User-Agent はハッシュを作るためだけに受け取り、保存しない。
-- 同じ人（同じハッシュ）が同じリンクを p_dedupe_minutes 分以内にまた押したら「重複」として数えない。
-- 返り値: counted（数えた）/ bot・prefetch・duplicate（数えなかった理由）/ missing（リンクがない）
create function public.record_link_click(
  p_link_id uuid,
  p_ip text,
  p_user_agent text,
  p_device text,
  p_country text,
  p_excluded text,
  p_dedupe_minutes integer default 10
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_day date := (now() at time zone 'Asia/Tokyo')::date;
  v_salt bytea;
  v_hash text;
  v_excluded text := p_excluded;
begin
  select owner_id into v_owner from public.short_links where id = p_link_id;
  if v_owner is null then
    return 'missing';
  end if;

  insert into public.link_hash_salts (day, salt) values (v_day, extensions.gen_random_bytes(32))
    on conflict (day) do nothing;
  select salt into v_salt from public.link_hash_salts where day = v_day;
  v_hash := encode(extensions.digest(v_salt || convert_to(coalesce(p_ip, '') || '|' || coalesce(p_user_agent, ''), 'UTF8'), 'sha256'), 'hex');

  if v_excluded is null and exists (
    select 1 from public.link_clicks c
     where c.link_id = p_link_id
       and c.visitor_hash = v_hash
       and c.excluded is null
       and c.clicked_at > now() - make_interval(mins => p_dedupe_minutes)
  ) then
    v_excluded := 'duplicate';
  end if;

  insert into public.link_clicks (link_id, device, country, visitor_hash, excluded)
  values (p_link_id, p_device, nullif(upper(p_country), ''), v_hash, v_excluded);

  insert into public.link_click_daily as d (link_id, owner_id, day, device, clicks, excluded)
  values (p_link_id, v_owner, v_day, p_device, case when v_excluded is null then 1 else 0 end, case when v_excluded is null then 0 else 1 end)
  on conflict (link_id, day, device) do update
    set clicks = d.clicks + excluded.clicks,
        excluded = d.excluded + excluded.excluded;

  return coalesce(v_excluded, 'counted');
end;
$$;

revoke execute on function public.record_link_click(uuid, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_link_click(uuid, text, text, text, text, text, integer) to service_role;
