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
import { ComposeAiCheck, ComposePlanHints } from "./compose/helpers";
import { ComposeAlerts, ComposeDraftSpace, ComposeResetControl } from "./compose/compose-top";
import { ComposeStepNav } from "./compose/step-nav";
import { ComposeStepBar } from "./compose/step-bar";
import { ComposeSummary } from "./compose/summary";
import { ComposeSentView } from "./compose/sent-view";
import { Button } from "@/components/ui/button";
import { COMPOSE_STEPS, type StepNo } from "@/lib/posts/compose-steps";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ComposePreview } from "./compose/preview";
import { useComposer, type ComposerProps } from "./compose/use-composer";

export type { ComposerInitial } from "./compose/use-composer";

// 投稿をつくる（新しい投稿と、保存した投稿の画面）。状態と操作は useComposer（compose/use-composer.tsx）に 1 つだけ持ち、
// 画面はステップごとの部品（compose/）に分けて描く（docs/design/compose-steps.md）。
// 1 画面に 1 ステップだけを出す。ほかのステップは外さずに隠す（AI の案・画像をつくる画面・フォーマットの穴など、部品の中の値を消さない）。
// すべて送った投稿は、決めることが残っていないので、送った文面を読むだけの画面にする（compose/sent-view.tsx）

// 左右が横に並ぶ幅か（並ぶときは、見え方を右の列に。並ばないときは ② と ⑤ の中に出す）。サーバーで描くときは並ぶものとする
const WIDE = "(min-width: 64rem)";
function subscribeWide(cb: () => void) {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);
}

// 画面の上に留まっている帯（PC の上の帯など）の下端。ステップを移ったときに、そこから少し下にステップの並びを出す
function stickyTopOffset(): number {
  let bottom = 0;
  for (const el of document.querySelectorAll<HTMLElement>("header")) {
    const st = getComputedStyle(el);
    if (st.display === "none" || (st.position !== "sticky" && st.position !== "fixed")) continue;
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  }
  return bottom + 12;
}

export function PostComposer(props: ComposerProps) {
  const c = useComposer(props);
  const { projectId, postId, results, notice, afterNotice, noticeTone, aiCheckEnabled, numbers, body, busy, notesOpen, setNotesOpen, noteIds, sentAny, pickNote, mode, composeStep, headingRef, pending, submit, goStep } = c;
  const wide = useWide();
  // すべて送った投稿は読むだけ。「ほかの SNS にも送る」を押したら、ステップの画面にして ② から
  const [extending, setExtending] = useState(false);
  const steps = mode !== "all_sent" || extending;

  // ステップを移ったら、ステップの並び（進みの札）と見出しが見えるところへ（読み上げにも、どこに来たかがわかるように、見出しにフォーカスを置く）。開いたときは動かさない。
  // 上の帯（sticky）の下に来るように位置を計って、すぐに移す。前は見出しへの scrollIntoView（smooth）で、見出しが上の帯の下に隠れたり、
  // 右の列が長くて下までスクロールしたまま「次へ」を押すと、途中で止まって左が空白に見えたりした（2026-11-12 PMO の本番での通しテスト 12）
  const shownStep = useRef(composeStep);
  const stepsTopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shownStep.current === composeStep) return;
    shownStep.current = composeStep;
    headingRef.current?.focus({ preventScroll: true });
    const top = stepsTopRef.current;
    if (!top) return;
    window.scrollTo({ top: Math.max(0, window.scrollY + top.getBoundingClientRect().top - stickyTopOffset()), behavior: "instant" });
  }, [composeStep, headingRef]);

  const notePicker = notesOpen && !postId && (
    <NotePicker projectId={projectId} bodyHasText={body.trim() !== ""} pickedIds={noteIds} onPick={pickNote} onClose={() => setNotesOpen(false)} />
  );
  const start = !postId && <ComposeStart projectId={projectId} aiEnabled={aiCheckEnabled} notesOpen={notesOpen} onNotes={() => setNotesOpen((o) => !o)} />;

  return (
    <>
      {/* 止めている間は画面が読み上げの対象から外れるので、進み具合はここで知らせる */}
      <p className="sr-only" role="status" aria-live="polite">
        {busy === "now" ? "送っています。数秒から数十秒かかります。このまま待ってください。" : busy === "schedule" ? "予約しています。" : busy === "draft" ? "保存しています。" : ""}
      </p>
      {/* 保存・送信を押したら、画面に移るか失敗が返るまで、本文の編集・送り先の変更などを止める（押せない・打てない） */}
      <div className="flex flex-col gap-4" inert={busy !== null || undefined} aria-busy={busy !== null || undefined}>
      {/* 見出し。下書きに保存する・リセットは、どのステップでも押せるようここに置く */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[26px] font-bold max-sm:text-[22px]">{postId ? (sentAny ? "送った投稿" : "下書き") : "投稿をつくる"}</h1>
        {!steps && start}
        {/* 送った投稿の「送った SNS には送り直さない」は、読むだけの画面の「ほかの SNS にも送る」の横に出す（2026-11-10 PM の指摘） */}
        {postId && !sentAny && <span className="text-[15px] text-faint">保存済み</span>}
        {steps && (
          <span className="ml-auto flex items-center gap-3">
            <ComposeResetControl c={c} />
            {composeStep < 5 && (
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => submit("draft")}>
                {busy === "draft" ? "保存しています…" : "下書きに保存する"}
              </Button>
            )}
          </span>
        )}
      </div>

      {/* 保存・送信の知らせと、送信の結果（送ったあとはこの投稿の画面に移り、ここに結果が出る） */}
      {notice && (noticeTone === "error" ? <ErrorBanner>{notice}</ErrorBanner> : <SuccessBanner>{notice}</SuccessBanner>)}
      {notice && afterNotice}
      {postId && <SendResults projectId={projectId} postId={postId} results={results} />}
      <ComposeAlerts c={c} />

      {steps ? (
        <div ref={stepsTopRef} className="flex flex-col gap-4">
          <StepsLayout c={c} wide={wide} start={start} notePicker={notePicker} headingRef={headingRef} />
          <ComposeDraftSpace c={c} />
        </div>
      ) : (
        <ComposeSentView
          c={c}
          onExtend={() => {
            setExtending(true);
            goStep(2);
          }}
        />
      )}

      {numbers}
      </div>
    </>
  );
}

// ステップの画面（compose-steps.md の 3.）
function StepsLayout({ c, wide, start, notePicker, headingRef }: { c: ReturnType<typeof useComposer>; wide: boolean; start: ReactNode; notePicker: ReactNode; headingRef: ReturnType<typeof useComposer>["headingRef"] }) {
  const { composeStep } = c;
  const step = COMPOSE_STEPS[composeStep - 1];
  const at = (n: StepNo) => composeStep === n;
  // 見え方: 横に並ぶ幅ではどのステップでも右の列。並ばない幅では ② と ⑤ の中だけ（ほかのステップでは畳む）
  const inlinePreview = !wide && (at(2) || at(5));
  return (
    <>
      <ComposeStepNav c={c} />
      <div className="grid grid-cols-[minmax(0,1.03fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-3 max-sm:pb-16">
          <section aria-labelledby="step-heading" className="flex flex-col gap-3.5 rounded-lg border border-border bg-surface px-6 py-5 max-sm:px-4 max-sm:py-4">
            <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-[18px] font-bold outline-none max-sm:text-[16px]">
              <span className="num mr-2 text-faint">{composeStep}</span>
              {step.title}
            </h2>
            <div hidden={!at(1)} className="flex flex-col gap-3.5">
              {start}
              {notePicker}
              <ComposeStepWrite c={c} steps />
              <ComposePlanHints c={c} />
            </div>
            <div hidden={!at(2)} className="flex flex-col gap-3.5">
              <ComposeStepTargets c={c} />
            </div>
            <div hidden={!at(3)} className="flex flex-col gap-3.5">
              <ComposeStepImages c={c} />
            </div>
            <div hidden={!at(4)} className="flex flex-col gap-3.5">
              <ComposeLinkNotices c={c} />
              <ComposeShortLinks c={c} />
            </div>
            <div hidden={!at(5)} className="flex flex-col gap-3.5">
              <ComposeSummary c={c} />
              <ComposeAiCheck c={c} />
              <ComposeStepSend c={c} steps />
            </div>
          </section>
          {inlinePreview && <ComposePreview c={c} />}
          {!wide && !inlinePreview && (
            <details className="rounded-lg border border-border bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold">見え方を見る</summary>
              <div className="border-t border-line">
                <ComposePreview c={c} />
              </div>
            </details>
          )}
          <ComposeStepBar c={c} />
        </div>
        {wide && (
          <div className="flex min-w-0 flex-col gap-3">
            <ComposePreview c={c} />
          </div>
        )}
      </div>
    </>
  );
}
