"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { appUrl } from "@/lib/sns/threads/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isOperatorEmail } from "./operator";
import { applyWaitlist, cancelWaitlist, declineWaitlist, inviteFromWaitlist, verifyTurnstileToken } from "./store";

// 招待の申し込み（F19。docs/architecture.md の 4.29）の操作

export type ApplyState = { status: "idle" } | { status: "done"; mailed: boolean } | { status: "error"; message: string; email: string; appNote: string; snsNote: string };

const MESSAGES = {
  invalid_email: "メールアドレスの形が正しくありません。もう一度お確かめください。",
  bot: "ロボットではないことを確かめられませんでした。画面を読み込み直して、もう一度お試しください。",
  rate_limited: "申し込みが混み合っています。1 時間ほどたってから、もう一度お試しください。",
  failed: "受け付けられませんでした。時間をおいてもう一度お試しください。",
} as const;

// Vercel では x-forwarded-for の最初が、利用者の IP アドレス
async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || null;
}

export async function applyAction(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const str = (k: string) => String(formData.get(k) ?? "").slice(0, 1000);
  const ip = await clientIp();
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const r = await applyWaitlist(
    createAdminClient(),
    { email: str("email"), appNote: str("app_note"), snsNote: str("sns_note"), ip, turnstileToken: str("cf-turnstile-response") || null, honeypot: str("website") },
    {
      appUrl: appUrl(),
      // IP アドレスのハッシュの鍵。運営者の秘密の値を使い回す（ジョブの合言葉。ローカルでなければ必ずある）
      hashKey: process.env.CRON_SECRET ?? "local",
      verifyTurnstile: secret ? (token, addr) => verifyTurnstileToken(secret, token, addr) : undefined,
    },
  );
  if (r.ok) return { status: "done", mailed: r.mail === "sent" };
  return { status: "error", message: MESSAGES[r.reason], email: str("email"), appNote: str("app_note"), snsNote: str("sns_note") };
}

// 確認のメールのリンクから取り消す（ページを開いただけでは消さず、ボタンを押したら消す。メールのリンクの先読みで消えないように）
export async function cancelAction(formData: FormData) {
  const done = await cancelWaitlist(createAdminClient(), String(formData.get("t") ?? "").slice(0, 100));
  redirect(`/waitlist/cancel?done=${done ? "1" : "0"}`);
}

// ===== 運営者の画面（/admin/waitlist） =====

async function requireOperator() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  if (!isOperatorEmail(email)) notFound();
}

const uuid = /^[0-9a-f-]{36}$/;

export async function inviteAction(id: string): Promise<{ error?: string; notice?: string }> {
  await requireOperator();
  if (!uuid.test(id)) return { error: "入力の形式が正しくありません。" };
  const r = await inviteFromWaitlist(createAdminClient(), id);
  if (!r.ok) return { error: r.message };
  return { notice: r.already ? "すでに登録済みのアドレスでした。招待は送らずに、申し込みを消しました。" : "招待のメールを送り、申し込みを消しました。" };
}

export async function declineAction(id: string): Promise<{ error?: string; notice?: string }> {
  await requireOperator();
  if (!uuid.test(id)) return { error: "入力の形式が正しくありません。" };
  const done = await declineWaitlist(createAdminClient(), id);
  return done ? { notice: "申し込みを消しました（メールは送っていません）。" } : { error: "申し込みが見つかりません。画面を読み込み直してください。" };
}
