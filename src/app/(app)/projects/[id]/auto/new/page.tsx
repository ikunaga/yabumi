import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { HeldNotice } from "@/components/auto-post/hold-banner";
import { PlanWizard, type WizardPreset } from "@/components/auto-post/plan-wizard";
import { getAutoPostHold } from "@/lib/auto-post/queries";
import { winnerTime } from "@/lib/metrics/winners";
import { loadWinners } from "@/lib/metrics/winners-queries";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";
import { wizardProps } from "../wizard-data";

export const metadata: Metadata = { title: "自動投稿をはじめる" };

// 自動の投稿を始める（docs/design/auto-post.md の 1.4・1.5）。「何を」「どこに」「どのくらい」を選び、見本と見込みを見て同意して始める。
// 伸びた投稿から来たとき（?format=&post=。docs/design/winning-posts.md の 5.）は、そのフォーマットと、伸びた SNS・時間帯を選んでおく。
// SNS と時刻は URL から受け取らず、サーバーで伸びた投稿を判定し直して決める
export default async function AutoNewPage(props: PageProps<"/projects/[id]/auto/new">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  // 運営者が止めている間は作れない（帯は auto/layout.tsx。DB の save_auto_plan でも断る）
  if (await getAutoPostHold()) return <HeldNotice projectId={project.id} />;
  return <PlanWizard {...await wizardProps(project.id, null)} preset={await presetOf(project.id, sp.format, sp.post)} />;
}

async function presetOf(projectId: string, format: unknown, post: unknown): Promise<WizardPreset | null> {
  const f = z.uuid().safeParse(format);
  if (!f.success) return null;
  const p = z.uuid().safeParse(post);
  const winner = p.success ? (await loadWinners(await createClient(), projectId)).winners.find((w) => w.postId === p.data) : undefined;
  if (!winner) return { formatId: f.data, sns: [], time: null, timeReason: "" };
  const t = winnerTime(winner.publishedAt);
  return { formatId: f.data, sns: winner.hits.map((h) => h.sns), time: t.time, timeReason: t.reason };
}
