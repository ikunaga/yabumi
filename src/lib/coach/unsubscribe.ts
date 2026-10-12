import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";

// メールの「このお知らせのメールを止める」（4.27）。ログインしなくても、合言葉（notification_prefs.unsubscribe_token）で止める。
// 止めるのはメールだけ（スマホの通知と画面の声かけはそのまま。設定の画面でいつでも戻せる）
export async function unsubscribeByToken(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !isUuid(token)) return false;
  const { data, error } = await createAdminClient().from("notification_prefs").update({ email_mode: "off" }).eq("unsubscribe_token", token).select("user_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
