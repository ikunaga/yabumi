"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManualSns, isSnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";

const urlSchema = z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(500)]);

// 手で投稿する SNS（note・Substack）のプロフィールの URL を登録する（任意）。空にすると消す
export async function saveManualChannel(projectId: string, sns: string, url: string): Promise<{ error?: string; ok?: boolean }> {
  if (!z.uuid().safeParse(projectId).success || !isSnsKey(sns) || !isManualSns(sns)) return { error: "入力の形式が正しくありません。" };
  const u = urlSchema.safeParse(url.trim());
  if (!u.success) return { error: "https:// から始まる URL を入れてください。" };
  const supabase = await createClient();
  const { error } = u.data
    ? await supabase.from("project_manual_channels").upsert({ project_id: projectId, sns, profile_url: u.data }, { onConflict: "project_id,sns" })
    : await supabase.from("project_manual_channels").delete().eq("project_id", projectId).eq("sns", sns);
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}
