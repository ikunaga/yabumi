import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeldNotice } from "@/components/auto-post/hold-banner";
import { PlanWizard } from "@/components/auto-post/plan-wizard";
import { getAutoPlan, getAutoPostHold } from "@/lib/auto-post/queries";
import { getProject } from "@/lib/projects/queries";
import { wizardProps } from "../../wizard-data";

export const metadata: Metadata = { title: "自動の投稿を編集" };

// 自動の投稿を直す（1.6 の「直す」）。始めるときと同じ 4 つのステップ。開くと「確かめる」から（どこを直すかは「直す」で戻る）。
// 保存のたびに同意し直す（X の自動化のルール: 機能を変えたら同意し直し。src/lib/auto-post/README.md）
export default async function AutoEditPage(props: PageProps<"/projects/[id]/auto/[planId]/edit">) {
  const { id, planId } = await props.params;
  const [project, plan] = await Promise.all([getProject(id), getAutoPlan(planId)]);
  if (!project || !plan || plan.projectId !== project.id) notFound();
  // 運営者が止めている間は直せない（帯は auto/layout.tsx。DB の save_auto_plan でも断る）
  if (await getAutoPostHold()) return <HeldNotice projectId={project.id} />;
  return <PlanWizard {...await wizardProps(project.id, plan)} />;
}
