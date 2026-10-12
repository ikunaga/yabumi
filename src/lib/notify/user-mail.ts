import { RESEND_API_URL } from "./operator";

// 利用者あてのメール（伴走の声かけ。docs/architecture.md の 4.27）。送るのは Resend の API（運営者への知らせと同じ）。
// RESEND_API_KEY がない環境（ローカルなど）では送らず、ログに件名だけ残す（本文やメールアドレスは残さない）
const DEFAULT_FROM = "矢書 <noreply@yabumi.app>";

export type UserMail = { to: string; subject: string; text: string; headers?: Record<string, string> };
export type UserMailDeps = { fetch?: typeof fetch; apiKey?: string | null; from?: string };
export type UserMailResult = "sent" | "skipped" | "failed";

export async function sendUserMail(mail: UserMail, deps: UserMailDeps = {}): Promise<UserMailResult> {
  const apiKey = deps.apiKey === undefined ? process.env.RESEND_API_KEY : deps.apiKey;
  if (!apiKey) {
    console.warn("[user-mail] RESEND_API_KEY がないので送りません:", mail.subject);
    return "skipped";
  }
  try {
    const res = await (deps.fetch ?? fetch)(RESEND_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: deps.from ?? process.env.NOTIFY_EMAIL_FROM ?? process.env.OPERATOR_EMAIL_FROM ?? DEFAULT_FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.headers ? { headers: mail.headers } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[user-mail] メールを送れませんでした", res.status, await res.text().catch(() => ""));
      return "failed";
    }
    return "sent";
  } catch (e) {
    console.error("[user-mail] メールを送れませんでした", e instanceof Error ? e.message : e);
    return "failed";
  }
}
