import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ConsultChat } from "@/components/ai/consult-chat";
import { ConsultHeader } from "@/components/ai/consult-header";
import { aiConfigured } from "@/lib/ai/anthropic";
import { getConsultThread, roadmapStepsFor } from "@/lib/ai/consult-queries";
import { consultTopicMeta } from "@/lib/ai/consult-topics";
import { getProject } from "@/lib/projects/queries";
import { isUuid } from "@/lib/uuid";

export async function generateMetadata(props: PageProps<"/projects/[id]/consult/[threadId]">): Promise<Metadata> {
  const { id, threadId } = await props.params;
  const thread = isUuid(id) && isUuid(threadId) ? await getConsultThread(id, threadId) : null;
  const meta = consultTopicMeta(thread?.topic);
  return { title: meta?.entry?.title ?? meta?.listTitle ?? "AI と相談" };
}

// AI と相談の 1 つの会話（F09、4.23）。一覧は /consult。削除は見出しの横の「…」から（削除したら一覧へ）
export default async function ConsultThreadPage(props: PageProps<"/projects/[id]/consult/[threadId]">) {
  const { id, threadId } = await props.params;
  if (!aiConfigured()) redirect(`/projects/${id}/consult`);
  const project = await getProject(id);
  if (!project || !isUuid(threadId)) notFound();
  const thread = await getConsultThread(id, threadId);
  if (!thread) notFound();
  const first = thread.messages[0];
  const firstText = first?.role === "user" && first.content.kind === "text" ? first.content.text.replace(/\s+/g, " ").trim() : null;
  return (
    <div className="flex max-w-[880px] flex-col gap-5 max-sm:gap-4">
      <ConsultHeader projectId={id} topic={thread.topic} threadId={thread.id} roadmapSteps={thread.topic === "roadmap" ? await roadmapStepsFor(id) : null} firstText={firstText} />
      <ConsultChat key={thread.id} projectId={id} threadId={thread.id} messages={thread.messages} initialTopic={null} />
    </div>
  );
}
