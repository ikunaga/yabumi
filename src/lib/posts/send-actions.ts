"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adapters } from "@/lib/sns/adapters";
import { SnsPublishError } from "@/lib/sns/adapters/types";
import { deletePublishedTarget } from "@/lib/sns/publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
