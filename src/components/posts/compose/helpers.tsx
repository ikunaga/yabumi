"use client";

import { AiCheckPanel } from "../ai-check-panel";
import { PlanHints } from "../plan-hints";
import { type SnsKey } from "@/lib/sns";
import { type Composer } from "./use-composer";

// 書くときの手伝い。設計を見返す（① 書く）と、送る前に AI に見てもらう（⑤ 送る）。docs/design/compose-steps.md

export function ComposePlanHints({ c }: { c: Composer }) {
  const { projectId, planHints, chosen } = c;
  return <PlanHints projectId={projectId} hints={planHints} sns={chosen} />;
}

export function ComposeAiCheck({ c }: { c: Composer }) {
  const { projectId, aiCheckEnabled, body, overrides, resetRound, chosen, applyCheckFix } = c;
  return (
    <AiCheckPanel
      key={resetRound}
      projectId={projectId}
      aiEnabled={aiCheckEnabled}
      texts={(chosen.length ? chosen : (["x"] as SnsKey[])).map((sns) => ({ sns, text: overrides[sns] ?? body }))}
      onApply={applyCheckFix}
    />
  );
}
