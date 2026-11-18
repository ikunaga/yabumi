import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeldNotice } from "@/components/auto-post/hold-banner";
import { PlanWizard } from "@/components/auto-post/plan-wizard";
import { getAutoPostHold } from "@/lib/auto-post/queries";
import { getProject } from "@/lib/projects/queries";
import { wizardProps } from "../wizard-data";

export const metadata: Metadata = { title: "自動の投稿をはじめる" };

// 自動の投稿を始める（docs/design/auto-post.md の 1.4・1.5）。「何を」「どこに」「どのくらい」を選び、見本と見込みを見て同意して始める
export default async function AutoNewPage(props: PageProps<"/projects/[id]/auto/new">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  // 運営者が止めている間は作れない（帯は auto/layout.tsx。DB の save_auto_plan でも断る）
  if (await getAutoPostHold()) return <HeldNotice projectId={project.id} />;
  return <PlanWizard {...await wizardProps(project.id, null)} />;
}
