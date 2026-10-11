"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// AI との会話を消す（docs/architecture.md の 4.14）。RLS で本人の会話だけが消せる。
// 会話の中身（ai_messages）はカスケードで消え、利用量の記録は会話との紐づけだけが外れる。設計に採用した内容は残る
export async function deleteAiThread(projectId: string, threadId: string, backPath: string): Promise<{ error?: string }> {
  const ids = z.array(z.uuid()).safeParse([projectId, threadId]);
  if (!ids.success || !backPath.startsWith(`/projects/${projectId}`)) return { error: "入力の形式が正しくありません。" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ai_threads").delete().eq("id", threadId).eq("project_id", projectId).select("id");
  if (error || !data?.length) return { error: "会話を消せませんでした。画面を読み込み直してください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`${backPath}?done=thread_deleted`);
}
