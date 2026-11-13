-- セキュリティ確認（2026-11-13、範囲 61664a0..main）の DB-L1 と参考 I1（PM の依頼）。
--
-- DB-L1: 送ったあと（pending 以外）の配信先の文面・タグなどを、利用者の権限（REST から直接）で書き換えられた。
-- 列の権限（grant update）とポリシー（posts_targets_update_own）は status を見ていないため。準備中の行のタグを変えると、
-- claim_due_targets が返す本文と、作ったコンテナが食い違う（影響は本人の投稿だけ）。
-- 利用者が書ける列（authenticated に update を grant している列: body_override・title・hashtags・quote_post_id・social_account_id）を、
-- pending でない行では変えさせない。止めるのは利用者の権限（authenticated。save_post も呼んだ人の権限で動く）からの変更だけにする。
-- サーバーの処理（service_role の送信ジョブ・送った結果の記録・X で手で投稿する番・switch_project_sns_account が失敗の行のアカウントを付け替える）と、
-- SNS のアカウントを消したときの外部キー（social_account_id を null にする。表の持ち主の権限で動く）は止めない。
-- いまのアプリは、pending でない行のこれらの列を利用者の権限で書いていない（save_post は pending の行だけを直す。2026-11-13 に調べた）

create function public.post_targets_lock_sent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'pending'
     and current_user = 'authenticated'
     and (new.body_override is distinct from old.body_override
       or new.title is distinct from old.title
       or new.hashtags is distinct from old.hashtags
       or new.quote_post_id is distinct from old.quote_post_id
       or new.social_account_id is distinct from old.social_account_id)
  then
    raise exception '送った（送っている）配信先の文面・タグ・送り先のアカウントは変えられません'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
comment on function public.post_targets_lock_sent() is '送ったあと（pending 以外）の配信先の、利用者が書ける列（文面・タイトル・タグ・引用・アカウント）を、利用者の権限からは変えさせない';
revoke all on function public.post_targets_lock_sent() from public, anon, authenticated, service_role;

create trigger post_targets_lock_sent
  before update of body_override, title, hashtags, quote_post_id, social_account_id on public.post_targets
  for each row execute function public.post_targets_lock_sent();

-- 参考 I1: タグの check が、ゼロ幅の文字（U+200B〜U+200F・U+202A〜U+202E・U+2060〜U+2064・U+FEFF）と 2 次元の配列を通した。
-- 画面とサーバーの決まり（src/lib/sns/hashtags.ts の isValidHashtag。文字・数字・結合文字・_ だけ）では前から弾いている。ここは REST から直接書くときの守り

alter table public.post_targets drop constraint post_targets_hashtags_check;
alter table public.post_targets add constraint post_targets_hashtags_check
  check (
    cardinality(hashtags) = 0
    or (
      array_ndims(hashtags) = 1
      and array_to_string(hashtags, ',', '') ~ ('^[^[:space:],#＃　' || U&'\200B-\200F\202A-\202E\2060-\2064\FEFF' || ']{1,50}(,[^[:space:],#＃　' || U&'\200B-\200F\202A-\202E\2060-\2064\FEFF' || ']{1,50}){0,4}$')
      -- 区切りの「,」の数が「個数 - 1」と同じ（タグの中に「,」があると、2 つに見えて上の形をすり抜けるため）
      and cardinality(hashtags) - 1 = length(array_to_string(hashtags, ',', '')) - length(replace(array_to_string(hashtags, ',', ''), ',', ''))
    )
  );

alter table public.post_formats drop constraint post_formats_hashtags_check;
alter table public.post_formats add constraint post_formats_hashtags_check
  check (
    jsonb_typeof(hashtags) = 'object'
    and (hashtags - array['all', 'x', 'threads', 'instagram', 'facebook', 'tiktok', 'youtube', 'note', 'substack']) = '{}'::jsonb
    -- strict にする（lax では、配列の中身が 1 つずつ @ に入り、配列かどうかを見られない）。
    -- 2 つ目は値が配列でないと誤りになるので silent（そのときは 1 つ目が false になり、check は通らない）。
    -- 中身が配列（2 次元）なら type() が string でないので弾く
    and not jsonb_path_exists(hashtags, 'strict $.* ? (@.type() != "array" || @.size() > 5)')
    and not jsonb_path_exists(hashtags, 'strict $.*[*] ? (@.type() != "string" || !(@ like_regex "^[^[:space:],#＃　​-‏‪-‮⁠-⁤﻿]{1,50}$"))', '{}', true)
  );
