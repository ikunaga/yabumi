-- AI と相談で、返事を作る処理を画面から切り離す（2026-11-21 オーナーの指摘「返事を待つ間に画面を離れるとエラーになる」。PM 了承）。
-- 送ったらサーバーが after() で返事を作り続け、画面は読み直しで待つ。その間の印と、作れなかった印を会話に持つ。
-- - replying_since: 返事を作り始めた時刻。null は作っていない。印を付けるのは「null か、古い（5 分より前）」の行だけ（サーバーの条件つき update）。
--   1 つの会話で同時に 2 つ作らない（待っている間に送れない）。古い印は、サーバーが途中で止まったときの残りとして扱い、次の送信を受け付ける
-- - reply_failed_at: 最後に返事を作れなかった時刻。画面で「返事を作れませんでした。もう一度送ってください」を出す。次に送ると null に戻す
-- 書くのはサーバー（管理の鍵）だけ。利用者は今までどおり自分の行を select できるだけ（20261011220100_explicit_grants。列の grant は要らない）
alter table public.ai_threads add column replying_since timestamptz;
alter table public.ai_threads add column reply_failed_at timestamptz;

comment on column public.ai_threads.replying_since is 'AI の返事を作り始めた時刻（作っている間だけ。null は作っていない）。5 分より前のものは途中で止まった残りとして扱う';
comment on column public.ai_threads.reply_failed_at is '最後に AI の返事を作れなかった時刻。次に送ると null に戻す';
