"use client";

import { DraftRestoreBar } from "@/components/ui/draft-restore";
import { useKeyboardOpen } from "./step-bar";
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

// 保存のエラーと、書きかけの帯。
// 書きかけの帯は、画面が動き出したとき（この端末の控えを読んだとき）に出るので、本文の欄より上に差し込むと欄が下にずれ、
// 押した所が別のものに変わって打った文字が入らなかった（2026-11-12 PMO の本番での通しテスト）。欄を動かさないよう、画面の下に浮かせて出す
// （PC は下の中央、スマホは画面の上）。戻すか捨てるかを選ぶと消える。
// スマホを下にしないのは、背の低い画面（375×667 など）で「戻る・次へ」の帯の上に置くと本文の欄に重なるため。上は見出しと進みの点で、打つ欄はない。
// PC は浮いた帯の分、画面の下に余白を足す（ComposeDraftSpace）ので、下のボタンも帯の上までスクロールできる。鍵盤が開いている間は隠す（書いている欄に重ねない）
export function ComposeAlerts({ c }: { c: Composer }) {
  const { result, restorable, restoreDraft, setRestorable, draftKey } = c;
  const keyboard = useKeyboardOpen();
  return (
    <>
      {result.error && <ErrorBanner>{result.error}</ErrorBanner>}
      {restorable && !keyboard && (
        <div className="fixed inset-x-0 bottom-6 z-30 mx-auto w-[min(44rem,calc(100%-2rem))] rounded-md shadow-pop max-sm:top-[calc(env(safe-area-inset-top)+0.5rem)] max-sm:bottom-auto">
          <DraftRestoreBar compact at={restorable.at} what="本文の書きかけ" onRestore={restoreDraft} onDiscard={() => (clearFormDraft(draftKey), setRestorable(null))} />
        </div>
      )}
    </>
  );
}

// 浮いた書きかけの帯の分の余白（PC だけ。画面のいちばん下に置く。上の欄は動かさない）
export function ComposeDraftSpace({ c }: { c: Composer }) {
  return c.restorable ? <div aria-hidden className="h-28 max-sm:hidden" /> : null;
}
