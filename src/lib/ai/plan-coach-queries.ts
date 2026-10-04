import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadHistory, type StoredMessage } from "./plan-coach";

// プロジェクトのアカウント設計の会話のうち、いちばん新しいもの（RLS で本人のものだけ）
export async function getLatestPlanThread(projectId: string): Promise<{ id: string; messages: StoredMessage[] } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_threads")
    .select("id")
    .eq("project_id", projectId)
    .eq("purpose", "account_plan")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, messages: await loadHistory(supabase, data.id) };
}
