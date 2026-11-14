"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { COMPOSE_STEPS, LAST_STEP, nextBlockedReason, type StepNo } from "@/lib/posts/compose-steps";
import { findUrls } from "@/lib/posts/profile-link";
import { type Composer } from "./use-composer";

// 鍵盤が開いているか（スマホ。見えている高さが画面より大きく減ったとき）。開いている間は下の帯を隠し、書いている欄に重ねない
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, []);
  return open;
}

// 下の帯: 戻る・次へ（docs/design/compose-steps.md の 3.）。スマホは画面の下（下のタブの上）に留める。⑤ では「次へ」を出さない（送るボタンは中に）
export function ComposeStepBar({ c }: { c: Composer }) {
  const { composeStep, goStep, nextOk, images, chosen, pending, body, textFor } = c;
  const keyboard = useKeyboardOpen();
  const reasonId = useId();
  // 「次へ」が押せない理由（① の本文が空・② の送り先が 0）。帯の右下に小さく出し、ボタンの説明にもつなぐ
  const reason = nextBlockedReason(composeStep, { body, chosen: chosen.length });
  const prev = composeStep > 1 ? ((composeStep - 1) as StepNo) : null;
  const next = composeStep < LAST_STEP ? ((composeStep + 1) as StepNo) : null;
  const nextLabel = next ? COMPOSE_STEPS[next - 1].label : "";
  // ③ 画像・④ リンクは、要らなければそのまま飛ばせる（ボタンの名前で伝える）
  const hasLink = findUrls(body).length > 0 || chosen.some((s) => findUrls(textFor(s)).length > 0);
  const primary = composeStep === 3 && images.length === 0 ? "画像なしで次へ" : composeStep === 4 && !hasLink ? "リンクなしで次へ" : `次へ（${nextLabel}）`;
  return (
    <div
      className={`flex flex-col gap-1 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(var(--tabbar-h,64px)+env(safe-area-inset-bottom))] max-sm:z-10 max-sm:border-t max-sm:border-border max-sm:bg-surface max-sm:px-4 max-sm:py-2.5 ${keyboard ? "max-sm:hidden" : ""}`}
    >
      <div className="flex items-center gap-3">
        {prev ? (
          <Button type="button" variant="text" onClick={() => goStep(prev)} disabled={pending}>
            ← 戻る
          </Button>
        ) : (
          <span />
        )}
        {next && (
          <span className="ml-auto flex items-center gap-2">
            {composeStep === 2 && chosen.length === 0 && (
              <Button type="button" variant="text" size="sm" onClick={() => goStep(next)} disabled={pending}>
                あとで選ぶ
              </Button>
            )}
            <Button type="button" onClick={() => goStep(next)} disabled={pending || !nextOk} aria-describedby={reason ? reasonId : undefined}>
              {primary} →
            </Button>
          </span>
        )}
      </div>
      {reason && (
        <p id={reasonId} className="text-right text-xs text-muted">
          {reason}
        </p>
      )}
    </div>
  );
}
