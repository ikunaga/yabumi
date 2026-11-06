import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ConsultChat } from "@/components/ai/consult-chat";
import { ConsultHeader } from "@/components/ai/consult-header";
import { ConsultSide } from "@/components/ai/consult-side";
import { Columns } from "@/components/ui/columns";
import { aiConfigured } from "@/lib/ai/anthropic";
import { isConsultTopic } from "@/lib/ai/consult";
import { roadmapStepsFor } from "@/lib/ai/consult-queries";
import { consultTopicMeta } from "@/lib/ai/consult-topics";
import { getProject } from "@/lib/projects/queries";
import { isUuid } from "@/lib/uuid";

export async function generateMetadata(props: PageProps<"/projects/[id]/consult/new">): Promise<Metadata> {
  const sp = await props.searchParams;
  return { title: consultTopicMeta(typeof sp.start === "string" ? sp.start : null)?.entry?.title ?? "新しい相談" };
}

// 新しい相談の会話（F09、4.23）。?start= の入口から始めると、すぐに最初の発言を送る。最初の返事のあとは /consult/[threadId] に移る
export default async function ConsultNewPage(props: PageProps<"/projects/[id]/consult/new">) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  if (!aiConfigured()) redirect(`/projects/${id}/consult`);
  const project = await getProject(id);
  if (!project) notFound();
  const topic = isConsultTopic(sp.start) ? sp.start : null;
  // 振り返りのやることから来たとき（?item=）。本人の今週・来週の振り返りのやることかは、送るときにサーバーが確かめる
  const itemId = topic === "review" && typeof sp.item === "string" && isUuid(sp.item) ? sp.item : null;
  // 目標の振り返り（概要の帯から。?goal=）。本人の active で期限が来た・届いた目標かは、送るときにサーバーが確かめる
  const goalId = topic === "goal_review" && typeof sp.goal === "string" && isUuid(sp.goal) ? sp.goal : null;
  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <ConsultHeader projectId={id} topic={topic} threadId={null} roadmapSteps={topic === "roadmap" ? await roadmapStepsFor(id) : null} />
      <Columns
        main={<ConsultChat key={`new-${topic ?? ""}-${itemId ?? ""}-${goalId ?? ""}`} projectId={id} threadId={null} messages={[]} initialTopic={topic} initialItemId={itemId} initialGoalId={goalId} />}
        side={<ConsultSide projectId={id} adopted={null} lead={consultTopicMeta(topic)?.entry?.lead} />}
      />
    </div>
  );
}
