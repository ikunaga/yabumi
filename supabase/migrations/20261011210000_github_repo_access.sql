-- GitHub App を他の人も入れられるようにする（Any account）ための、本人が読めるリポジトリの記録。方針は docs/architecture.md の 4.10
-- /user/installations は、本人がインストールのリポジトリのどれか 1 つにでも権限があれば返す。組織のインストールや、
-- 他人の個人リポジトリの共同作業者として見えるインストールでは、インストールのトークンで読める範囲が本人の権限より広い。
-- そこで、GitHub の利用者の認可のときに /user/installations/{id}/repositories で本人が読めるリポジトリを確かめ、その ID を記録する。
-- null は「インストール先が本人の個人アカウント」で、インストールで読めるもの（本人が選んだリポジトリ）すべて。
alter table public.github_installations add column repo_ids bigint[];

comment on column public.github_installations.repo_ids is
  '本人が読めるリポジトリの ID（GitHub の利用者の認可で確かめたもの）。null はインストール先が本人の個人アカウントで、インストールの範囲すべて';

-- これまでの行は、オーナーだけが使う間（Only on this account）に本人の個人アカウントへ入れたもの
