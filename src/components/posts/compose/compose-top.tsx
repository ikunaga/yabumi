"use client";

import { DraftRestoreBar } from "@/components/ui/draft-restore";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/feedback";
import { draftImagesMayBeGone } from "@/lib/media/rules";
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

// 保存のエラーと、書きかけの画像が戻せなかったときの知らせ（書きかけの帯は ComposeDraftBar）
export function ComposeAlerts({ c }: { c: Composer }) {
  const { result, restoreMissing, setRestoreMissing } = c;
  return (
    <>
      {result.error && <ErrorBanner>{result.error}</ErrorBanner>}
      {restoreMissing > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface2 px-3.5 py-2 text-[13px] leading-[1.7]">
          <span>
            <span className="mr-1.5 font-bold text-signal">● 要確認</span>
            書きかけの画像のうち {restoreMissing} 枚は戻せませんでした（投稿に添えていない画像は 1 日で消えます）。もう一度添えてください。
          </span>
          <button type="button" onClick={() => setRestoreMissing(0)} className="text-muted hover:text-fg hover:underline">
            閉じる
          </button>
        </p>
      )}
    </>
  );
}

// 書きかけの帯。画面が動き出したとき（この端末の控えを読んだとき）に出るので、本文の欄より上に差し込むと欄が下にずれ、
// 押した所が別のものに変わって打った文字が入らなかった（2026-11-12 PMO の本番での通しテスト）。欄を動かさず、どの欄にも重ならないよう、
// ステップの並び（1 書く〜5 送る）の行に重ねて出す（呼ぶ側が relative の枠のいちばん上に置く。ページと一緒に動く）。
// 見出し・「リセット」・「下書きに保存する」は覆わない（前は見出しの行に重ね、閉じるまで「下書きに保存する」が押せなかった。2026-11-13 PMO2 の確かめ）。
// PC は 1 行の細い形でステップの並びの行に収まり、スマホは 2〜3 行でステップの枠の上の端（見出し）まで重なる。戻すか捨てるかを選ぶと消える
export function ComposeDraftBar({ c }: { c: Composer }) {
  const { restorable, restoreDraft, discardDraft } = c;
  if (!restorable) return null;
  // 控えに画像があれば、帯に枚数を出す。添えていない画像は 1 日で片付けるので、古い控えでは戻せないことがあると先に添える（4.62）
  const draftImages = restorable.value.images?.length ?? 0;
  const old = draftImagesMayBeGone(restorable.at);
  return (
    <div className="absolute inset-x-0 top-0 z-20 rounded-md shadow-pop">
      <DraftRestoreBar
        compact
        at={restorable.at}
        what={draftImages ? `本文と画像 ${draftImages} 枚の書きかけ` : "本文の書きかけ"}
        note={draftImages && old ? "画像は戻せないことがあります。" : undefined}
        onRestore={restoreDraft}
        onDiscard={discardDraft}
      />
    </div>
  );
}
