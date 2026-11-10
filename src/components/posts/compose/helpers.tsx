"use client";

import { AiCheckPanel } from "../ai-check-panel";
import { PlanHints } from "../plan-hints";
import { type SnsKey } from "@/lib/sns";
import { type Composer } from "./use-composer";

// 書くときの手伝い（設計を見返す・送る前に AI に見てもらう）
export function ComposeHelpers({ c }: { c: Composer }) {
  const { projectId, planHints, aiCheckEnabled, body, overrides, resetRound, chosen, applyCheckFix } = c;
  return (
    <>
      <PlanHints projectId={projectId} hints={planHints} sns={chosen} />
      <AiCheckPanel
        key={resetRound}
        projectId={projectId}
        aiEnabled={aiCheckEnabled}
        texts={(chosen.length ? chosen : (["x"] as SnsKey[])).map((sns) => ({ sns, text: overrides[sns] ?? body }))}
        onApply={applyCheckFix}
      />
    </>
  );
}
