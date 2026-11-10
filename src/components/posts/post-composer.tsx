"use client";

import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { ComposeStart } from "./compose-start";
import { NotePicker } from "./note-picker";
import { SendResults } from "./send-results";
import { ComposeStepWrite } from "./compose/step-write";
import { ComposeStepTargets } from "./compose/step-targets";
import { ComposeLinkNotices } from "./compose/link-notices";
import { ComposeStepImages } from "./compose/step-images";
import { ComposeShortLinks } from "./compose/short-links";
import { ComposeStepSend } from "./compose/step-send";
import { ComposeHelpers } from "./compose/helpers";
import { ComposePreview } from "./compose/preview";
import { useComposer, type ComposerProps } from "./compose/use-composer";

export type { ComposerInitial } from "./compose/use-composer";

// 投稿をつくる（新しい投稿と、保存した投稿の画面）。状態と操作は useComposer（compose/use-composer.tsx）に 1 つだけ持ち、
// 画面はステップごとの部品（compose/）に分けて描く（docs/design/compose-steps.md）
export function PostComposer(props: ComposerProps) {
  const c = useComposer(props);
  const { projectId, postId, results, notice, afterNotice, noticeTone, aiCheckEnabled, numbers, body, busy, notesOpen, setNotesOpen, noteIds, sentAny, pickNote } = c;
  return (
    <>
      {/* 止めている間は画面が読み上げの対象から外れるので、進み具合はここで知らせる */}
      <p className="sr-only" role="status" aria-live="polite">
        {busy === "now" ? "送っています。数秒から数十秒かかります。このまま待ってください。" : busy === "schedule" ? "予約しています。" : busy === "draft" ? "保存しています。" : ""}
      </p>
      {/* 保存・送信を押したら、画面に移るか失敗が返るまで、本文の編集・送り先の変更などを止める（押せない・打てない） */}
      <div className="flex flex-col gap-4" inert={busy !== null || undefined} aria-busy={busy !== null || undefined}>
      {/* 見出し。新しい投稿は、自分で書くか AI とネタを出すかの札を横に並べる（AI を使わなくても書いて送れることがわかるように） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[26px] font-bold max-sm:text-[22px]">{postId ? (sentAny ? "送った投稿" : "下書き") : "投稿をつくる"}</h1>
        {!postId && <ComposeStart projectId={projectId} aiEnabled={aiCheckEnabled} notesOpen={notesOpen} onNotes={() => setNotesOpen((o) => !o)} />}
        {postId && <span className="text-[15px] text-faint">{sentAny ? "送った SNS は選び直せません" : "保存済み"}</span>}
      </div>

      {/* 保存・送信の知らせと、送信の結果（送ったあとはこの投稿の画面に移り、ここに結果が出る） */}
      {notice && (noticeTone === "error" ? <ErrorBanner>{notice}</ErrorBanner> : <SuccessBanner>{notice}</SuccessBanner>)}
      {notice && afterNotice}
      {postId && <SendResults projectId={projectId} postId={postId} results={results} />}

      {notesOpen && !postId && (
        <NotePicker projectId={projectId} bodyHasText={body.trim() !== ""} pickedIds={noteIds} onPick={pickNote} onClose={() => setNotesOpen(false)} />
      )}

      <div className="grid grid-cols-[minmax(0,1.03fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        {/* 左: 本文・送り先・短縮リンク・日時・送る */}
        <div className="flex min-w-0 flex-col gap-3">
          <section aria-labelledby="draft-heading" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
            <ComposeStepWrite c={c} />

            <ComposeStepTargets c={c} />

            <ComposeLinkNotices c={c} />

            <ComposeStepImages c={c} />

            <ComposeShortLinks c={c} />

            <ComposeStepSend c={c} />
          </section>

          {/* 書くときの手伝い。使わなくても送れるので、閉じて控えめに置く */}
          <section aria-label="書くときの手伝い（使わなくても送れます）" className="flex flex-col gap-2">
            <ComposeHelpers c={c} />
          </section>
        </div>

        {/* 右: SNS ごとの見え方と文面（タブ）、SNS ごとの注意 */}
        <div className="flex min-w-0 flex-col gap-3">
          <ComposePreview c={c} />
        </div>
      </div>

      {numbers}
      </div>
    </>
  );
}
