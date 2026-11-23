"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

export type AutoPostPrefsState = { error?: string; savedAt?: number };

// 自動投稿の知らせ（docs/design/auto-post.md の 2.7）の、スマホの通知とメールそれぞれの受け取る・受け取らない。
// お知らせの設定と同じ行。本人が変えられるのは auto_post_push・auto_post_email だけ（grant の列。20261116120000_auto_post_engine・20261123120000_auto_post_mail）
export async function saveAutoPostPrefs(_prev: AutoPostPrefsState, formData: FormData): Promise<AutoPostPrefsState> {
  const user = await requireUser();
  const push = formData.get("auto_post_push");
  const email = formData.get("auto_post_email");
  // メールの選択は AUTO_POST_MAIL が on のときだけ出す。出していないときは、メールの設定を変えない
  if ((push !== "on" && push !== "off") || (email !== null && email !== "on" && email !== "off")) return { error: "選択肢から選んでください。" };
  const patch = { auto_post_push: push === "on", ...(email === null ? {} : { auto_post_email: email === "on" }) };
  const supabase = await createClient();
  // 行があれば直し、なければ作る（ほかの設定は既定のまま）
  const { data: updated, error: updateError } = await supabase.from("notification_prefs").update(patch).eq("user_id", user.id).select("user_id");
  const { error } = updateError || updated?.length ? { error: updateError } : await supabase.from("notification_prefs").insert({ user_id: user.id, ...patch });
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath("/settings/notifications");
  return { savedAt: Date.now() };
}
