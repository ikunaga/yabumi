"use client";

import { guardAction } from "@/lib/client-errors";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { saveAutoPostPrefs, type AutoPostPrefsState } from "@/lib/auto-post/prefs-actions";

// 自動投稿の知らせ（2.7）。スマホの通知とメールを、それぞれ受け取る・受け取らない（初期はどちらも受け取る）。
// スマホの通知は src/lib/auto-post/engine.ts の pushAllowed、メールは src/lib/auto-post/mail.ts が読む
// email が null のときは、メールの選択を出さない（AUTO_POST_MAIL が on でない間。src/lib/auto-post/mail.ts の autoPostMailEnabled）
export function AutoPostPrefsForm({ push, email }: { push: boolean; email: boolean | null }) {
  const [state, action, pending] = useActionState<AutoPostPrefsState, FormData>(guardAction(saveAutoPostPrefs, (m) => ({ error: m })), {});
  return (
    <form action={action} className="flex flex-col gap-4 px-6 pt-1 pb-5 text-[15px] max-sm:px-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-bold">スマホの通知</legend>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="auto_post_push" value="on" defaultChecked={push} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            受け取る
            <span className="block text-xs text-muted">AI が投稿をつくったとき・確認待ちになったとき・止まったときに送ります。つくったときの知らせは、1 日 1 通にまとめます</span>
          </span>
        </label>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="auto_post_push" value="off" defaultChecked={!push} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>受け取らない</span>
        </label>
      </fieldset>
      {email !== null && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-bold">メール</legend>
          <label className="flex items-start gap-2 leading-[1.7]">
            <input type="radio" name="auto_post_email" value="on" defaultChecked={email} className="mt-1 size-4 accent-[var(--primary)]" />
            <span>
              受け取る
              <span className="block text-xs text-muted">確認が要るとき・下書きに残したとき・止まったときに送ります。投稿の本文は入れません</span>
            </span>
          </label>
          <label className="flex items-start gap-2 leading-[1.7]">
            <input type="radio" name="auto_post_email" value="off" defaultChecked={!email} className="mt-1 size-4 accent-[var(--primary)]" />
            <span>受け取らない</span>
          </label>
        </fieldset>
      )}
      <p className="text-xs text-muted">{email !== null ? "確認待ちの投稿は、どちらを止めても「自動投稿」と「ホーム」の画面で見られます" : "確認待ちの投稿は、「自動投稿」と「ホーム」の画面で見られます"}</p>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          保存する
        </Button>
        {state.savedAt && !pending && <span className="text-sm font-bold text-success">保存しました</span>}
      </div>
      {state.error && <ErrorBanner>{state.error}</ErrorBanner>}
    </form>
  );
}
