-- 最近のコミットから投稿のネタを作る（要求 F04 の一部。docs/architecture.md の 4.15）。
-- ネタと、利用者への質問・答えは、アカウント設計と同じ ai_threads / ai_messages に置く（RLS も同じ。書き込みはサーバーだけ、利用者は自分のものを読めるだけ）。
-- コミットのメッセージや差分（原文）は保存しない。保存するのは、AI が出したネタ（コミットの sha と、AI が書いた短い説明）と、利用者の答えだけ。

alter table public.ai_threads drop constraint ai_threads_purpose_check;
alter table public.ai_threads add constraint ai_threads_purpose_check check (purpose in ('account_plan', 'post_ideas'));
