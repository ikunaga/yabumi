import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readIdeasThread, type IdeasThread } from "./post-ideas";

// プロジェクトの投稿のネタのうち、いちばん新しいもの（RLS で本人のものだけ）
export async function getLatestIdeasThread(projectId: string): Promise<IdeasThread | null> {
  const supabase = await createClient();
  const { data: t, error } = await supabase
    .from("ai_threads")
    .select("id")
    .eq("project_id", projectId)
    .eq("purpose", "post_ideas")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!t) return null;
  const { data, error: e2 } = await supabase.from("ai_messages").select("id, role, content, created_at").eq("thread_id", t.id).order("created_at").order("id");
  if (e2) throw e2;
  return readIdeasThread(t.id, data);
}
