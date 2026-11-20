"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setAutoPlanInstructions } from "@/lib/auto-post/actions";
import type { AutoPlan } from "@/lib/auto-post/types";
import { SampleCard } from "./sample-card";

// 回し方の画面の見本（docs/design/auto-sample-image.md の 1.1）。始めたあとでも、見本を見ながら書き方の指示を直せる。
// 指示はその場で回し方に保存する（set_auto_plan_instructions。同意の取り直しはしない）。まだ作っていない回から効く
export function PlanSample({ plan }: { plan: AutoPlan }) {
  const router = useRouter();
  const [instructions, setInstructions] = useState(plan.instructions);
  return (
    <SampleCard
      projectId={plan.projectId}
      input={() => ({
        id: plan.id,
        name: plan.name,
        kind: plan.kind,
        materials: plan.materials,
        targets: plan.targets,
        xLink: plan.xLink,
        schedule: plan.schedule,
        instructions,
        image: plan.image,
        leadHours: plan.leadHours,
      })}
      instructions={instructions}
      onInstructions={async (next) => {
        const r = await setAutoPlanInstructions(plan.id, next);
        if (!r.ok) return r.error;
        setInstructions(r.data);
        router.refresh();
        return null;
      }}
      series={plan.kind === "series"}
    />
  );
}
