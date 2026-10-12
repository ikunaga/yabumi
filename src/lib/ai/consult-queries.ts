import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadConsultHistory, type ConsultMessage } from "./consult";
import { loadRoadmap } from "@/lib/roadmap/queries";
import { roadmapStepState, type RoadmapStepState } from "./consult-schema";
import { summarizeConsultThread, type ThreadMessageDigest } from "./consult-topics";

// AI と相談の会話の読み込み（RLS で本人のものだけ）

// topicTitle: 入口の名前（入口から始めたとき）。title: 中身がわかる題。adopted: 採用した案の数（summarizeConsultThread）
export type ConsultThreadSummary = { id: string; updatedAt: string; topicTitle: string | null; title: string; adopted: number };

// 過去の会話の一覧（新しい順に 20 件）
export async function listConsultThreads(projectId: string): Promise<ConsultThreadSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_threads")
    .select(
      "id, updated_at, ai_messages(role, created_at, kind:content->>kind, text:content->>text, topic:content->>topic, title:content->>title, option:content->proposal->options->0->>title, legacy:content->actions->0->>title)",
    )
    .eq("project_id", projectId)
    .eq("purpose", "consult")
    .order("updated_at", { ascending: false })
    .order("created_at", { referencedTable: "ai_messages", ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    updatedAt: t.updated_at,
    ...summarizeConsultThread(t.ai_messages as unknown as ThreadMessageDigest[]),
  }));
}

export async function getConsultThread(projectId: string, threadId: string): Promise<{ id: string; messages: ConsultMessage[]; topic: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("ai_threads").select("id").eq("id", threadId).eq("project_id", projectId).eq("purpose", "consult").maybeSingle();
  if (!data) return null;
  const messages = await loadConsultHistory(supabase, data.id);
  const first = messages[0];
  return { id: data.id, messages, topic: first?.role === "user" && first.content.kind === "start" ? first.content.topic : null };
}

// ロードマップづくりの会話の見出しの段取り（今のロードマップから、どこまで決まったか）
export async function roadmapStepsFor(projectId: string): Promise<RoadmapStepState> {
  const view = await loadRoadmap(projectId);
  const r = view.roadmap;
  return roadmapStepState({
    hasKgi: Boolean(r?.kgi),
    hasKpiTargets: (r?.kpiTargets.length ?? 0) > 0,
    itemWeeks: view.items.filter((i) => i.weekStart >= view.thisWeek).map((i) => Math.round((Date.parse(i.weekStart) - Date.parse(view.thisWeek)) / (7 * 86_400_000))),
  });
}
