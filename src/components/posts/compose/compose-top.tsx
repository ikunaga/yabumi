"use client";

import { DraftRestoreBar } from "@/components/ui/draft-restore";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/feedback";
import { clearFormDraft } from "@/lib/form-draft";
import { type Composer } from "./use-composer";

// どのステップでも見えるもの: 予約の日時・リセット（保存した内容に戻す）・保存のエラー・書きかけの帯（docs/design/compose-steps.md の 3.）

// 予約の日時とリセット。送った投稿では出さない。何も変えていないときも出さない
export function ComposeResetControl({ c }: { c: Composer }) {
  const { postId, resetOpen, setResetOpen, resetRound, resetChanges, resetAll, closeReset, sentAny, plannedLabel } = c;
  return (
    <span className="flex items-baseline gap-3">
      {plannedLabel && <span className="num text-[15px] text-faint">{plannedLabel} {sentAny ? "に送信" : "予約"}</span>}
      {!sentAny && resetChanges.length > 0 && (
        <button type="button" aria-haspopup="dialog" onClick={() => setResetOpen(true)} className="text-[13px] text-muted underline-offset-2 hover:text-fg hover:underline">
          {postId ? "保存した内容に戻す" : "リセット"}
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {resetRound > 0 ? (postId ? "保存した内容に戻しました。" : "書いた内容をリセットしました。") : ""}
      </span>
      <ConfirmDialog
        open={resetOpen}
        title={postId ? "保存した内容に戻しますか？" : "書いた内容をリセットしますか？"}
        confirmLabel={postId ? "戻す" : "リセットする"}
        onConfirm={resetAll}
        onClose={closeReset}
      >
        <p>{postId ? "この画面で変えた次のものが、保存したときの内容に戻ります。" : "次のものを消して、開いたときの状態に戻します。"}</p>
        <ul className="list-disc pl-5">
          {resetChanges.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">元には戻せません。</p>
      </ConfirmDialog>
    </span>
  );
}

// 保存のエラーと、書きかけの帯
export function ComposeAlerts({ c }: { c: Composer }) {
  const { result, restorable, restoreDraft, setRestorable, draftKey } = c;
  return (
    <>
      {result.error && <ErrorBanner>{result.error}</ErrorBanner>}
      {restorable && <DraftRestoreBar at={restorable.at} what="本文の書きかけ" onRestore={restoreDraft} onDiscard={() => (clearFormDraft(draftKey), setRestorable(null))} />}
    </>
  );
}
