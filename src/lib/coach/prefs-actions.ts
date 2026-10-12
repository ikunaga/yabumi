"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

// お知らせの設定を保存する（4.27）。RLS で本人の行だけ。配信の停止の合言葉は変えない
const MODES = ["weekly_and_behind", "weekly", "off"] as const;
const schema = z.object({
  email_mode: z.enum(MODES),
  push_mode: z.enum(MODES),
  behind_weekday: z.coerce.number().int().min(1).max(5),
});

export type PrefsFormState = { error?: string; savedAt?: number };

export async function saveNotificationPrefs(_prev: PrefsFormState, formData: FormData): Promise<PrefsFormState> {
  const user = await requireUser();
  const parsed = schema.safeParse({ email_mode: formData.get("email_mode"), push_mode: formData.get("push_mode"), behind_weekday: formData.get("behind_weekday") });
  if (!parsed.success) return { error: "選択肢から選んでください。" };
  const supabase = await createClient();
  // upsert は user_id も書き換えようとして断られる（本人が変えられるのは設定の 3 つだけ）。行があれば直し、なければ作る
  const { data: updated, error: updateError } = await supabase.from("notification_prefs").update(parsed.data).eq("user_id", user.id).select("user_id");
  const { error } = updateError || updated?.length ? { error: updateError } : await supabase.from("notification_prefs").insert({ user_id: user.id, ...parsed.data });
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath("/settings/notifications");
  return { savedAt: Date.now() };
}
