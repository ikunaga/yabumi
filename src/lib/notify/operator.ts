import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// 運営者へのメールの知らせ（docs/architecture.md の 4.22「悪用への備え」、決定 D22）。送り先は OPERATOR_EMAIL、送るのは Resend の API。
// RESEND_API_KEY か OPERATOR_EMAIL がない環境（ローカルなど）では送らず、サーバーのログに残すだけにする。
// 本文に利用者の個人情報（メールアドレス・ID・プロジェクトの名前など）を入れない

export const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "矢書 <noreply@yabumi.app>";

export type OperatorMail = { subject: string; text: string };
export type OperatorNotifyDeps = { fetch?: typeof fetch; apiKey?: string | null; to?: string | null; from?: string };
export type OperatorNotifyResult = "sent" | "logged" | "failed";

export async function notifyOperator(mail: OperatorMail, deps: OperatorNotifyDeps = {}): Promise<OperatorNotifyResult> {
  const apiKey = deps.apiKey === undefined ? process.env.RESEND_API_KEY : deps.apiKey;
  const to = deps.to === undefined ? process.env.OPERATOR_EMAIL : deps.to;
  if (!apiKey || !to) {
    console.warn("[operator] メールの設定がないので、ログにだけ残します", JSON.stringify(mail));
    return "logged";
  }
  try {
    const res = await (deps.fetch ?? fetch)(RESEND_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: deps.from ?? process.env.OPERATOR_EMAIL_FROM ?? DEFAULT_FROM, to: [to], subject: `【矢書の運営】${mail.subject}`, text: mail.text }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[operator] メールを送れませんでした", res.status, await res.text().catch(() => ""));
      return "failed";
    }
    return "sent";
  } catch (e) {
    console.error("[operator] メールを送れませんでした", e instanceof Error ? e.message : e);
    return "failed";
  }
}

// 同じ件（key）は windowDays 日に 1 回だけ知らせる。送れなかったとき・ログにだけ残したときは記録を消し、次の機会にまた知らせる
export async function notifyOperatorOnce(
  admin: SupabaseClient<Database>,
  key: string,
  windowDays: number,
  mail: OperatorMail,
  deps: OperatorNotifyDeps = {},
): Promise<OperatorNotifyResult | "skipped"> {
  const { data: claimed, error } = await admin.rpc("claim_operator_notification", { p_key: key, p_window: `${windowDays} days` });
  if (error) throw error;
  if (!claimed) return "skipped";
  const result = await notifyOperator(mail, deps);
  if (result !== "sent") await admin.from("operator_notifications").delete().eq("key", key);
  return result;
}
