import "server-only";
import { listMadeAutoPosts } from "@/lib/auto-post/queries";
import type { ComponentProps } from "react";
import type { PlanWizard } from "@/components/auto-post/plan-wizard";
import { fakeAiMode } from "@/lib/auto-post/ai";
import { suggestKind } from "@/lib/auto-post/suggest";
import { photoConfigured } from "@/lib/ai/gemini-image";
import { createClient } from "@/lib/supabase/server";
import type { AutoPlan } from "@/lib/auto-post/types";
import { loadMaterialCounts } from "@/lib/auto-post/ui-queries";
import { loadTimeTrends } from "@/lib/metrics/time-trends";
import { winnersCardText } from "@/lib/metrics/winners";
import { loadWinners } from "@/lib/metrics/winners-queries";
import { SNS, type SnsKey } from "@/lib/sns";
import { getAccountPlan } from "@/lib/plan/queries";
import { connectedAccounts } from "@/lib/posts/queries";
import { isAppProject } from "@/lib/projects/product-types";
import { getProject } from "@/lib/projects/queries";
import { toYmd } from "@/lib/time";

// 始める・直す画面に渡すもの（材料の数・つないだ SNS・設計の役割と頻度・時間帯の傾向）。AI は呼ばない
export async function wizardProps(projectId: string, plan: AutoPlan | null): Promise<ComponentProps<typeof PlanWizard>> {
  const db = await createClient();
  const [counts, accounts, account, trends, project, winners, notice, made] = await Promise.all([
    loadMaterialCounts(projectId),
    connectedAccounts(projectId),
    getAccountPlan(projectId),
    loadTimeTrends(projectId),
    getProject(projectId),
    // 伸びた投稿は、始めるときだけ読む（決まりで判定するだけで、AI は呼ばない）
    plan ? Promise.resolve(null) : loadWinners(db, projectId),
    // AI の画像の注意を読んだか（本人の行だけ。RLS）
    db.from("ai_image_notices").select("owner_id").maybeSingle(),
    // 編集のとき: もう作った、これから送る投稿（保存のポップアップで、いつから変わるかを出す）
    plan ? listMadeAutoPosts(plan.id) : Promise.resolve({ made: [], taken: [] }),
  ]);
  const roles = account ? (Object.keys(account.plan.cadence.roles) as SnsKey[]).filter((k) => account.plan.cadence.roles[k]?.trim()) : [];
  const pillarNames = account ? account.plan.pillars.items.map((i) => i.name.trim()).filter(Boolean) : [];
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
      pillars: pillarNames.length,
      pillarNames,
    },
    kindSuggestion: suggestKind(suggestMaterials),
    // 「開発の進み」は、宣伝するものがアプリのときだけ出す（CLAUDE.md）
    isApp: project ? isAppProject(project) : false,
    connected: Object.keys(accounts) as SnsKey[],
    planRoles: roles,
    trends,
    planFrequency: account?.plan.cadence.frequency ?? null,
    today: toYmd(new Date()),
    winners: winners ? winnersCardText(winners, (s) => SNS[s].label) : null,
    // 自動の回の画像（鍵がないときは選べない。偽の AI の確かめでは選べる）
    photo: { enabled: photoConfigured() || !!fakeAiMode(), acknowledged: !!notice.data },
    made: made.made,
    takenDueAts: made.taken,
  };
}
