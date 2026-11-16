"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

export type AutoPostPrefsState = { error?: string; savedAt?: number };

// 自動の投稿のスマホの通知（作った・確かめ待ち・止まった。docs/design/auto-post.md の 2.7）の受け取る・受け取らない。
// お知らせの設定と同じ行。本人が変えられるのは auto_post_push だけ（grant の列。20261116120000_auto_post_engine）
export async function saveAutoPostPrefs(_prev: AutoPostPrefsState, formData: FormData): Promise<AutoPostPrefsState> {
  const user = await requireUser();
  const v = formData.get("auto_post_push");
  if (v !== "on" && v !== "off") return { error: "選択肢から選んでください。" };
  const on = v === "on";
  const supabase = await createClient();
  // 行があれば直し、なければ作る（ほかの設定は既定のまま）
  const { data: updated, error: updateError } = await supabase.from("notification_prefs").update({ auto_post_push: on }).eq("user_id", user.id).select("user_id");
  const { error } = updateError || updated?.length ? { error: updateError } : await supabase.from("notification_prefs").insert({ user_id: user.id, auto_post_push: on });
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath("/settings/notifications");
  return { savedAt: Date.now() };
}
