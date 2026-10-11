import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadConsultHistory, type ConsultMessage } from "./consult";

// AI と相談の会話の読み込み（RLS で本人のものだけ）

export type ConsultThreadSummary = { id: string; updatedAt: string; title: string };

// 過去の会話の一覧（新しい順に 20 件）。名前は最初の発言の先頭
export async function listConsultThreads(projectId: string): Promise<ConsultThreadSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_threads")
    .select("id, updated_at, ai_messages(content, created_at)")
    .eq("project_id", projectId)
    .eq("purpose", "consult")
    .order("updated_at", { ascending: false })
    .order("created_at", { referencedTable: "ai_messages", ascending: true })
    .limit(1, { referencedTable: "ai_messages" })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((t) => {
    const first = (t.ai_messages as unknown as { content: { kind?: string; text?: string; topic?: string } }[])[0]?.content;
    const text = first?.kind === "text" ? first.text ?? "" : first?.kind === "start" ? topicTitle(first.topic) : "相談";
    return { id: t.id, updatedAt: t.updated_at, title: text.length > 30 ? `${text.slice(0, 30)}…` : text || "相談" };
  });
}

const TOPIC_TITLE: Record<string, string> = {
  what_to_post: "何を投稿すればいい？",
  no_reaction: "反応がない",
  which_sns: "どの SNS に力を入れる？",
  roadmap: "目標とロードマップ",
  review: "数字の振り返り",
};

export function topicTitle(topic: string | undefined): string {
  return (topic && TOPIC_TITLE[topic]) || "相談";
}

export async function getConsultThread(projectId: string, threadId: string): Promise<{ id: string; messages: ConsultMessage[] } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("ai_threads").select("id").eq("id", threadId).eq("project_id", projectId).eq("purpose", "consult").maybeSingle();
  if (!data) return null;
  return { id: data.id, messages: await loadConsultHistory(supabase, data.id) };
}
