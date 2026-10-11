-- テーブルと関数の権限を、必要なものだけ明示的に与える（docs/architecture.md の 4.17）。
-- Supabase は既定で、public に作ったテーブル・関数のすべての権限を anon と authenticated に与える（「新しいテーブルを自動で公開する」）。
-- それに頼ると、RLS を付け忘れたテーブルや、利用者に呼ばせるつもりのない関数が、画面側のキーから使えてしまう。
-- ここで既定をやめ、いまあるテーブルにはポリシーに合う操作だけを与え直す。これからのマイグレーションも、テーブルごとに grant を書く。
-- 本番の「Automatically expose new tables」の設定がどちらでも、同じ権限になる。

-- ===== これから作るものに、自動で権限を与えない =====
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- ===== いまあるテーブル: いったんすべて外す =====
-- service_role（サーバーの secret キー）はそのまま。RLS を通らないので、使うのはサーバーの処理だけ
revoke all on table
  public.projects,
  public.social_accounts,
  public.social_account_tokens,
  public.project_social_accounts,
  public.posts,
  public.post_targets,
  public.account_plans,
  public.ai_threads,
  public.ai_messages,
  public.ai_usage,
  public.github_installations,
  public.project_github_repos,
  public.project_manual_channels,
  public.sns_api_usage
from anon, authenticated;

-- ===== ログインした利用者（authenticated）に、RLS のポリシーと同じ操作だけを与える =====
-- anon（ログインしていない人）には、どのテーブルも与えない
grant select, insert, update, delete on public.projects to authenticated;
grant select, update, delete on public.social_accounts to authenticated;          -- 追加は OAuth の受け口（サーバー）だけ
grant select, insert, delete on public.project_social_accounts to authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, delete on public.post_targets to authenticated;
-- 配信先の追加・変更は、送信の状態などを書き換えられないよう列ごとに（20261003120000、20261004180000 と同じ）
grant insert (post_id, owner_id, sns, body_override, social_account_id, title) on public.post_targets to authenticated;
grant update (body_override, social_account_id, title) on public.post_targets to authenticated;
grant select, insert, update, delete on public.account_plans to authenticated;
grant select, delete on public.ai_threads to authenticated;                        -- 書き込みはサーバーだけ。消すのは本人（4.14）
grant select on public.ai_messages to authenticated;
grant select on public.ai_usage to authenticated;
grant select on public.github_installations to authenticated;
grant select, delete on public.project_github_repos to authenticated;
grant select, insert, update, delete on public.project_manual_channels to authenticated;
grant select on public.sns_api_usage to authenticated;
-- social_account_tokens: 利用者には何も与えない（サーバーだけが扱う）

-- ===== 関数 =====
-- 利用者が呼ぶもの（security definer の中で本人を確かめている）は authenticated だけに。anon からは呼べなくする
revoke execute on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb) to authenticated;
-- is_manual_sns は配信先とプロフィールの検査（check 制約・ポリシー）で使うので、ログインした利用者に残す
revoke execute on function public.is_manual_sns(text) from public, anon;
grant execute on function public.is_manual_sns(text) to authenticated;
-- トリガーの関数は直接呼ぶものではない（トリガーとしての実行に権限は要らない）
revoke execute on function public.set_updated_at() from public, anon, authenticated;
