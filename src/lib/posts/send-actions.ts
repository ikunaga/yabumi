"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adapters } from "@/lib/sns/adapters";
import { SnsPublishError } from "@/lib/sns/adapters/types";
import { deletePublishedTarget } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const urlSchema = z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2000)]);

// 手で投稿する SNS（note・Substack）に投稿したことを記録する。URL は任意
export async function markManualPosted(projectId: string, postId: string, targetId: string, url: string): Promise<{ error?: string }> {
  const ids = z.array(z.uuid()).safeParse([projectId, postId, targetId]);
  if (!ids.success) return { error: "入力の形式が正しくありません。" };
  const u = urlSchema.safeParse(url.trim());
  if (!u.success) return { error: "URL は https:// から始まる形で入れてください（空でも記録できます）。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_manual_target_posted", { p_target_id: targetId, p_url: u.data });
  if (error) return { error: "記録できませんでした。画面を読み込み直してください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/posts/${postId}?done=manual_posted`);
}

// 送信済みの投稿を SNS 上で取り消す（矢書の下書きは残す）
export async function deleteFromSns(projectId: string, postId: string, targetId: string): Promise<{ error?: string }> {
  const ids = z.array(z.uuid()).safeParse([projectId, postId, targetId]);
  if (!ids.success) return { error: "入力の形式が正しくありません。" };

  // 本人の配信先であることを、利用者の権限（RLS）で確かめてから、サーバーの権限で取り消す
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("post_targets")
    .select("id, posts!inner(project_id)")
    .eq("id", targetId)
    .eq("post_id", postId)
    .eq("posts.project_id", projectId)
    .maybeSingle();
  if (!target) return { error: "投稿が見つかりません。画面を読み込み直してください。" };

  try {
    await deletePublishedTarget(createAdminClient(), targetId, { adapters });
  } catch (e) {
    if (e instanceof SnsPublishError) return { error: e.userMessage };
    console.error("[deleteFromSns]", e);
    return { error: "取り消せませんでした。時間をおいてもう一度お試しください。" };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/posts/${postId}?done=deleted_sns`);
}
