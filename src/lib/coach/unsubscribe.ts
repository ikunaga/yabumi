import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";

// メールの「このお知らせのメールを止める」（4.27）。ログインしなくても、合言葉（notification_prefs.unsubscribe_token）で止める。
// 止めるのはメールだけ（スマホの通知と画面の声かけはそのまま。設定の画面でいつでも戻せる）。
// kind: coach は投稿のペースのお知らせのメール、auto は自動投稿の知らせのメール（リンクの k=auto。src/lib/auto-post/mail.ts）。止めるのはその種類だけ
export type UnsubscribeKind = "coach" | "auto";
export const unsubscribeKind = (k: unknown): UnsubscribeKind => (k === "auto" ? "auto" : "coach");

export async function unsubscribeByToken(token: unknown, kind: UnsubscribeKind = "coach"): Promise<boolean> {
  if (typeof token !== "string" || !isUuid(token)) return false;
  const patch = kind === "auto" ? { auto_post_email: false } : { email_mode: "off" as const };
  const { data, error } = await createAdminClient().from("notification_prefs").update(patch).eq("unsubscribe_token", token).select("user_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
