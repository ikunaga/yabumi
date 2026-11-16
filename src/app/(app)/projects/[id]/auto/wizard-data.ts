import "server-only";
import type { ComponentProps } from "react";
import type { PlanWizard } from "@/components/auto-post/plan-wizard";
import { suggestKind } from "@/lib/auto-post/suggest";
import type { AutoPlan } from "@/lib/auto-post/types";
import { loadMaterialCounts } from "@/lib/auto-post/ui-queries";
import { loadTimeTrends } from "@/lib/metrics/time-trends";
import { getAccountPlan } from "@/lib/plan/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import type { SnsKey } from "@/lib/sns";
import { toYmd } from "@/lib/time";

// 始める・直す画面に渡すもの（材料の数・つないだ SNS・設計の役割と頻度・時間帯の傾向）。AI は呼ばない
export async function wizardProps(projectId: string, plan: AutoPlan | null): Promise<ComponentProps<typeof PlanWizard>> {
  const [counts, accounts, account, trends] = await Promise.all([loadMaterialCounts(projectId), connectedAccounts(projectId), getAccountPlan(projectId), loadTimeTrends(projectId)]);
  const roles = account ? (Object.keys(account.plan.cadence.roles) as SnsKey[]).filter((k) => account.plan.cadence.roles[k]?.trim()) : [];
  const pillars = account ? account.plan.pillars.items.filter((i) => i.name.trim()).length : 0;
  const suggestMaterials = {
    unusedNotes: counts.unusedNotes,
    unusedPhotoNotes: counts.unusedPhotoNotes,
    seriesFormats: counts.seriesFormats.length,
    destinations: counts.destinations.length,
  };
  return {
    projectId,
    plan,
    materials: {
      counts: suggestMaterials,
      seriesFormats: counts.seriesFormats,
      destinations: counts.destinations,
      events: counts.events,
      pillars,
    },
    kindSuggestion: suggestKind(suggestMaterials),
    connected: Object.keys(accounts) as SnsKey[],
    planRoles: roles,
    trends,
    planFrequency: account?.plan.cadence.frequency ?? null,
    today: toYmd(new Date()),
  };
}
