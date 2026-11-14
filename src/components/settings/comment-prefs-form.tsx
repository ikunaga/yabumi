"use client";

import { guardAction } from "@/lib/client-errors";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { saveCommentPrefs, type CommentPrefsState } from "@/lib/sns/comments/prefs-actions";

// SNS のコメントのまとめ（スマホ・1 日 1 回。4.70）。初期は受け取る。メールは送らない
export function CommentPrefsForm({ mode }: { mode: "daily" | "off" }) {
  const [state, action, pending] = useActionState<CommentPrefsState, FormData>(guardAction(saveCommentPrefs, (m) => ({ error: m })), {});
  return (
    <form action={action} className="flex flex-col gap-4 px-6 pt-1 pb-5 text-[15px] max-sm:px-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">コメントのまとめ</legend>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="comment_push" value="daily" defaultChecked={mode === "daily"} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            受け取る
            <span className="block text-xs text-muted">新しいコメントがあった日の 19:00 に、1 日 1 回、件数だけをスマホに送ります</span>
          </span>
        </label>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="comment_push" value="off" defaultChecked={mode === "off"} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>受け取らない</span>
        </label>
      </fieldset>
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
