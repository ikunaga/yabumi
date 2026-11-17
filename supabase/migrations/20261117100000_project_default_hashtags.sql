-- プロジェクトの「いつものタグ」（2026-11-17 オーナーの依頼、案 A。docs/architecture.md の 4.59）。
-- 投稿をつくるで新しい投稿を開いたとき・AI のネタ／ネタ帳／相談から下書きを作るときに、SNS ごとのタグの欄に最初から入れる。
-- 形と決まりは post_formats.hashtags と同じ（20261112130000_post_hashtags）: {"all": [...], "instagram": [...]}。all は全 SNS 共通、
-- SNS の名前のキーはその SNS だけ（あればこちらを使う）。それぞれ 5 個まで、1 つ 50 字まで、空白・「,」「#」なし。
-- アカウント設計の hashtags（AI に渡す「付けるとき」つきの候補）とは別のもの。
-- 権限: projects は表ごとに select・insert・update・delete を authenticated に許し（20261011220100_explicit_grants）、RLS で本人の行だけ。
-- 列の grant は足さない（本人の行のこの列を本人が書けてよい）
alter table public.projects add column default_hashtags jsonb not null default '{}'::jsonb
  check (
    jsonb_typeof(default_hashtags) = 'object'
    and (default_hashtags - array['all', 'x', 'threads', 'instagram', 'facebook', 'tiktok', 'youtube', 'note', 'substack']) = '{}'::jsonb
    -- post_formats.hashtags と同じ。strict で配列かどうかを見る。2 つ目は値が配列でないと誤りになるので silent
    and not jsonb_path_exists(default_hashtags, 'strict $.* ? (@.type() != "array" || @.size() > 5)')
    and not jsonb_path_exists(default_hashtags, 'strict $.*[*] ? (@.type() != "string" || !(@ like_regex "^[^[:space:],#＃　]{1,50}$"))', '{}', true)
  );

comment on column public.projects.default_hashtags is 'いつものタグ（# なし）。投稿をつくるで新しい投稿・作った下書きのタグの欄に最初から入れる。all は全 SNS 共通、SNS の名前のキーはその SNS だけ';
