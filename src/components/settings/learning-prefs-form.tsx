"use client";

import { guardAction } from "@/lib/client-errors";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { saveLearningPrefs, type LearningPrefsState } from "@/lib/learning/prefs-actions";

// 学びの表示（今日の用語・ひとこと。4.47）のオンとオフ。初期はオン
export function LearningPrefsForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<LearningPrefsState, FormData>(guardAction(saveLearningPrefs, (m) => ({ error: m })), {});
  return (
    <form action={action} className="flex flex-col gap-4 px-6 pt-1 pb-5 text-[15px] max-sm:px-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">学びの表示</legend>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="learning_enabled" value="on" defaultChecked={enabled} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            出す
            <span className="block text-xs text-muted">概要に「今日の用語」を 1 行、作業のあとに「ひとこと」を 1 日 1 回まで</span>
          </span>
        </label>
        <label className="flex items-start gap-2 leading-[1.7]">
          <input type="radio" name="learning_enabled" value="off" defaultChecked={!enabled} className="mt-1 size-4 accent-[var(--primary)]" />
          <span>出さない</span>
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
