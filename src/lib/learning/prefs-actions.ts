"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

export type LearningPrefsState = { error?: string; savedAt?: number };

// 学びの表示（今日の用語・ひとこと）のオンとオフ（4.47）。お知らせの設定と同じ行。本人が変えられるのは learning_enabled だけ（grant の列）
export async function saveLearningPrefs(_prev: LearningPrefsState, formData: FormData): Promise<LearningPrefsState> {
  const user = await requireUser();
  const v = formData.get("learning_enabled");
  if (v !== "on" && v !== "off") return { error: "選択肢から選んでください。" };
  const learning_enabled = v === "on";
  const supabase = await createClient();
  // 行があれば直し、なければ作る（ほかの設定は既定のまま）
  const { data: updated, error: updateError } = await supabase.from("notification_prefs").update({ learning_enabled }).eq("user_id", user.id).select("user_id");
  const { error } = updateError || updated?.length ? { error: updateError } : await supabase.from("notification_prefs").insert({ user_id: user.id, learning_enabled });
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath("/settings/notifications");
  revalidatePath("/projects", "layout");
  return { savedAt: Date.now() };
}
