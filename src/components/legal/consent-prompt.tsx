"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptConsent, type ConsentState } from "@/lib/legal/consent-actions";
import { ConsentCheck } from "./consent-check";

// ログインしたあとの画面の上に出す、同意の帯（決定 D31）。いまの版の規約・ポリシーに同意していない方にだけ出す
// （招待より前に登録した方、②の変更が施行されたあとの再同意）。同意しなくても使えなくはしない
export function ConsentPrompt({ effectiveDate, changed }: { effectiveDate: string; changed: boolean }) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(acceptConsent, {});
  return (
    <form action={action} className="flex flex-col gap-2 border-b border-line bg-surface px-6 py-3.5 max-sm:px-4" aria-labelledby="consent-prompt-title">
      <p id="consent-prompt-title" className="text-[14px] font-bold">
        {changed ? `利用規約とプライバシーポリシーを変えました（${effectiveDate}施行）。ご確認のうえ、同意をお願いします。` : "利用規約とプライバシーポリシーへの同意をお願いします。"}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ConsentCheck effectiveDate={effectiveDate} invalid={Boolean(state.error)} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "記録しています…" : "同意する"}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
