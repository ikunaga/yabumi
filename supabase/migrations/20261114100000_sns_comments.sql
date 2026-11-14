-- SNS のコメントに気付く（段階 A。docs/design/sns-comments.md、docs/architecture.md の 4.70。2026-11-14 オーナーの了承）。
-- Threads・Instagram・Facebook に yabumi から送った投稿のコメントを、送ってから 7 日まで 3 時間ごとに読み、30 日保存する。
-- 書くのはジョブ（service_role）だけ。利用者は自分の行を読むことと、「見た」にすること（関数）だけができる。

-- ===== 読んだコメント =====
create table public.sns_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  post_target_id uuid not null references public.post_targets (id) on delete cascade,
  -- SNS を外す（social_accounts の行が消える）と、コメントも消える
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  sns public.sns_key not null check (sns in ('threads', 'instagram', 'facebook')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  parent_external_id text check (parent_external_id is null or char_length(parent_external_id) between 1 and 200),
  author_name text not null default '' check (char_length(author_name) <= 100),
  body text not null default '' check (char_length(body) <= 3000),
  -- つないだアカウント（利用者）が書いたもの。新しいコメントに数えない
  is_own boolean not null default false,
  commented_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  seen_at timestamptz,
  notified_at timestamptz,
  unique (post_target_id, external_id)
);

comment on table public.sns_comments is 'SNS の投稿に付いたコメント（他の人の名前と本文）。30 日で消す。AI には送らない（docs/design/sns-comments.md）';

create index sns_comments_owner_new_idx on public.sns_comments (owner_id, commented_at) where not is_own and seen_at is null;
create index sns_comments_target_idx on public.sns_comments (post_target_id, commented_at);
create index sns_comments_account_idx on public.sns_comments (social_account_id);
create index sns_comments_commented_idx on public.sns_comments (commented_at);

alter table public.sns_comments enable row level security;
create policy "sns_comments_select_own" on public.sns_comments
  for select to authenticated using ((select auth.uid()) = owner_id);

revoke all on public.sns_comments from public, anon, authenticated;
-- 画面に要る列だけ（social_account_id・fetched_at・notified_at・owner_id・external_id は出さない）
grant select (id, post_target_id, sns, parent_external_id, author_name, body, is_own, commented_at, seen_at) on public.sns_comments to authenticated;
grant all on table public.sns_comments to service_role;

-- ===== 投稿ごとの、次に読みに行く予定（サーバーだけ） =====
create table public.sns_comment_polls (
  post_target_id uuid primary key references public.post_targets (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  next_check_at timestamptz not null,
  last_checked_at timestamptz,
  -- 前に読んだときのコメントの数（Instagram は数が同じなら一覧を読まない）
  last_count integer check (last_count is null or last_count >= 0),
  -- 続けて失敗した回数
  fails smallint not null default 0 check (fails >= 0),
  -- 権限がない・投稿が見つからないなどで、もう読まない
  stopped boolean not null default false
);

comment on table public.sns_comment_polls is 'コメントを読みに行く予定（サーバーだけ）。送ってから 7 日を過ぎたら消す';

create index sns_comment_polls_owner_idx on public.sns_comment_polls (owner_id);

alter table public.sns_comment_polls enable row level security;
revoke all on public.sns_comment_polls from public, anon, authenticated;
grant all on table public.sns_comment_polls to service_role;

-- ===== お知らせの設定: コメントのまとめ（スマホ・1 日 1 回） =====
alter table public.notification_prefs
  add column comment_push text not null default 'daily' check (comment_push in ('daily', 'off'));
grant insert (comment_push) on public.notification_prefs to authenticated;
grant update (comment_push) on public.notification_prefs to authenticated;

-- ===== 投稿を取り消した（status = deleted）・SNS の投稿 ID が消えたら、コメントと予定もすぐ消す =====
create function public.drop_sns_comments_on_target_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.sns_comments where post_target_id = new.id;
  delete from public.sns_comment_polls where post_target_id = new.id;
  return new;
end;
$$;

revoke all on function public.drop_sns_comments_on_target_removed() from public, anon, authenticated, service_role;

create trigger post_targets_drop_sns_comments
  after update of status, external_post_id on public.post_targets
  for each row
  when ((new.status = 'deleted' and old.status is distinct from 'deleted') or (old.external_post_id is not null and new.external_post_id is null))
  execute function public.drop_sns_comments_on_target_removed();

-- ===== 読みに行く投稿（ジョブ用） =====
-- p_scopes: 読む SNS と、そのコメントの権限（例 {"threads": "threads_read_replies"}）。ここにない SNS は返さない
create function public.due_sns_comment_targets(
  p_scopes jsonb,
  p_limit integer default 200,
  p_owner_id uuid default null,
  p_now timestamptz default now()
)
returns table (
  post_target_id uuid,
  owner_id uuid,
  sns text,
  external_post_id text,
  social_account_id uuid,
  account_external_id text,
  account_handle text,
  published_at timestamptz,
  last_count integer,
  fails smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.owner_id, t.sns::text, t.external_post_id, t.social_account_id, a.external_id, a.handle, t.published_at, p.last_count, coalesce(p.fails, 0)::smallint
    from public.post_targets t
    join public.social_accounts a on a.id = t.social_account_id
    join public.social_account_tokens k on k.social_account_id = a.id
    left join public.sns_comment_polls p on p.post_target_id = t.id
   where t.status = 'published'
     and t.sns in ('threads', 'instagram', 'facebook')
     and p_scopes ? t.sns::text
     and k.scopes @> array[p_scopes ->> t.sns::text]
     and t.external_post_id is not null
     and t.published_at is not null
     and t.published_at > p_now - interval '7 days'
     and a.status = 'active'
     and (p_owner_id is null or t.owner_id = p_owner_id)
     and (p.post_target_id is null or (not p.stopped and p.next_check_at <= p_now))
   order by coalesce(p.next_check_at, t.published_at)
   limit least(greatest(p_limit, 1), 1000);
$$;

revoke all on function public.due_sns_comment_targets(jsonb, integer, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.due_sns_comment_targets(jsonb, integer, uuid, timestamptz) to service_role;

-- ===== 見たことにする（時刻はサーバーが決める。自分の行だけ） =====
create function public.mark_sns_comments_seen(p_project_id uuid, p_post_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.sns_comments c
     set seen_at = now()
    from public.post_targets t
    join public.posts p on p.id = t.post_id
   where c.post_target_id = t.id
     and c.owner_id = v_uid
     and p.owner_id = v_uid
     and p.project_id = p_project_id
     and (p_post_id is null or p.id = p_post_id)
     and c.seen_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_sns_comments_seen(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_sns_comments_seen(uuid, uuid) to authenticated;

-- ===== 期限: コメントは 30 日、予定は送ってから 8 日で消す =====
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
  update public.ai_messages m
     set content = jsonb_set(jsonb_set(m.content, '{xPost,text}', '""'::jsonb), '{xPost,interest}', '""'::jsonb)
   where m.role = 'user'
     and m.content ->> 'kind' = 'ideas_request'
     and m.content ->> 'source' = 'x_post'
     and jsonb_typeof(m.content -> 'xPost') = 'object'
     and (coalesce(m.content -> 'xPost' ->> 'text', '') <> '' or coalesce(m.content -> 'xPost' ->> 'interest', '') <> '')
     and m.created_at < now() - interval '24 hours'
     and exists (select 1 from public.ai_threads t where t.id = m.thread_id and t.purpose = 'post_ideas' and t.closed_at is null);
  delete from public.pending_page_choices where expires_at < now();
  delete from public.link_clicks where clicked_at < now() - interval '90 days';
  delete from public.link_hash_salts where day < (now() at time zone 'Asia/Tokyo')::date - 1;
  delete from public.play_account_creations where created_at < now() - interval '30 days';
  -- SNS のコメント（4.70）
  delete from public.sns_comments where commented_at < now() - interval '30 days';
  delete from public.sns_comment_polls p
   using public.post_targets t
   where t.id = p.post_target_id
     and (t.published_at is null or t.published_at < now() - interval '8 days');
  return query select v_threads, v_ai_usage, v_sns_usage;
end;
$$;

-- ===== 定期のジョブ =====
-- コメントを読む: 3 時間ごと（日本時間の 0・3・6…時の 15 分）。読み残しを拾うため 25 分・35 分にも呼ぶ（読むのは予定の来たものだけ）
select cron.schedule('yabumi-import-sns-comments', '15,25,35 */3 * * *', $$select public.invoke_job('/api/jobs/import-sns-comments')$$);
-- まとめの通知: 毎日 19:00（日本時間）
select cron.schedule('yabumi-comment-digest', '0 10 * * *', $$select public.invoke_job('/api/jobs/comment-digest')$$);
