"use client";

import { guardAction } from "@/lib/client-errors";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { saveAutoPostPrefs, type AutoPostPrefsState } from "@/lib/auto-post/prefs-actions";

// 自動の投稿のスマホの通知（作った・確かめ待ち・止まった。2.7）。初期は受け取る。src/lib/auto-post/engine.ts の pushAllowed が読む
export function AutoPostPrefsForm({ on }: { on: boolean }) {
  const [state, action, pending] = useActionState<AutoPostPrefsState, FormData>(guardAction(saveAutoPostPrefs, (m) => ({ error: m })), {});
  return (
    <form action={action} className="flex flex-col gap-4 px-6 pt-1 pb-5 text-[15px] max-sm:px-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">自動の投稿の通知</legend>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="auto_post_push" value="on" defaultChecked={on} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            受け取る
            <span className="block text-xs text-muted">文を作ったとき（1 日 1 通にまとめます）・確かめ待ちになったとき・止まったときに、スマホに送ります</span>
          </span>
        </label>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="auto_post_push" value="off" defaultChecked={!on} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            受け取らない
            <span className="block text-xs text-muted">確かめ待ちは、自動の投稿の画面と概要で見られます</span>
          </span>
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
