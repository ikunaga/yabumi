"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

export type CommentPrefsState = { error?: string; savedAt?: number };

// コメントのまとめ（スマホ・1 日 1 回。4.70）の受け取る・受け取らない。お知らせの設定と同じ行。本人が変えられるのは comment_push だけ（grant の列）
export async function saveCommentPrefs(_prev: CommentPrefsState, formData: FormData): Promise<CommentPrefsState> {
  const user = await requireUser();
  const v = formData.get("comment_push");
  if (v !== "daily" && v !== "off") return { error: "選択肢から選んでください。" };
  const supabase = await createClient();
  // 行があれば直し、なければ作る（ほかの設定は既定のまま）
  const { data: updated, error: updateError } = await supabase.from("notification_prefs").update({ comment_push: v }).eq("user_id", user.id).select("user_id");
  const { error } = updateError || updated?.length ? { error: updateError } : await supabase.from("notification_prefs").insert({ user_id: user.id, comment_push: v });
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath("/settings/notifications");
  return { savedAt: Date.now() };
}
