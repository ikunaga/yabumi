"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { COMPOSE_STEPS, LAST_STEP, type StepNo } from "@/lib/posts/compose-steps";
import { findUrls } from "@/lib/posts/profile-link";
import { type Composer } from "./use-composer";

// 鍵盤が開いているか（スマホ。見えている高さが画面より大きく減ったとき）。開いている間は下の帯を隠し、書いている欄に重ねない
export function useKeyboardOpen(): boolean {
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
  const prev = composeStep > 1 ? ((composeStep - 1) as StepNo) : null;
  const next = composeStep < LAST_STEP ? ((composeStep + 1) as StepNo) : null;
  const nextLabel = next ? COMPOSE_STEPS[next - 1].label : "";
  // ③ 画像・④ リンクは、要らなければそのまま飛ばせる（ボタンの名前で伝える）
  const hasLink = findUrls(body).length > 0 || chosen.some((s) => findUrls(textFor(s)).length > 0);
  const primary = composeStep === 3 && images.length === 0 ? "画像なしで次へ" : composeStep === 4 && !hasLink ? "リンクなしで次へ" : `次へ（${nextLabel}）`;
  return (
    <div
      className={`flex items-center gap-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[calc(var(--tabbar-h,64px)+env(safe-area-inset-bottom))] max-sm:z-10 max-sm:border-t max-sm:border-border max-sm:bg-surface max-sm:px-4 max-sm:py-2.5 ${keyboard ? "max-sm:hidden" : ""}`}
    >
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
          <Button type="button" onClick={() => goStep(next)} disabled={pending || !nextOk}>
            {primary} →
          </Button>
        </span>
      )}
    </div>
  );
}
