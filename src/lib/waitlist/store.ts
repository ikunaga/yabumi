import { createHash, createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type UserMailDeps, type UserMailResult, sendUserMail } from "@/lib/notify/user-mail";
import type { Database } from "@/lib/supabase/database.types";
import { ALL_PER_HOUR, PER_IP_PER_HOUR, cleanNote, normalizeEmail } from "./rules";

// 招待の申し込み（F19、決定 D30。docs/architecture.md の 4.29）。読み書きはサーバー（secret キー）だけ。
// 申し込み → 確認のメール（取り消しのリンクつき）→ 運営者が一覧から「招待する」（Supabase の招待のメール）か「お断りする」→ 行を消す

type Db = SupabaseClient<Database>;

export type ApplyInput = { email: string; appNote: string; snsNote: string; ip: string | null; turnstileToken: string | null; honeypot: string };
export type ApplyDeps = {
  now?: () => Date;
  appUrl: string;
  // IP アドレスのハッシュの鍵（日ごとに変える。docs/architecture.md の 4.29）
  hashKey: string;
  mail?: UserMailDeps;
  sendMail?: typeof sendUserMail;
  // Turnstile の確認（鍵がなければ確かめない）
  verifyTurnstile?: (token: string | null, ip: string | null) => Promise<boolean>;
};
// accepted: 受け付けた（すでに申し込み済みでも同じ返事にする。ほかの人のアドレスが申し込み済みかを知られないように）
export type ApplyResult = { ok: true; mail: UserMailResult | "none" } | { ok: false; reason: "invalid_email" | "bot" | "rate_limited" | "failed" };

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// その日（日本時間）だけの鍵で作る IP アドレスのハッシュ。日をまたぐと同じ IP でも別の値になり、行どうしを長くつなげられない
export function ipHash(ip: string, key: string, now: Date): string {
  const day = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  return createHmac("sha256", `waitlist-ip:${key}`).update(`${day}:${ip}`).digest("hex");
}

export function confirmationMail(email: string, cancelUrl: string) {
  return {
    to: email,
    subject: "矢書の招待の申し込みを受け付けました",
    text: [
      "矢書（やぶみ）の招待の申し込みを受け付けました。ありがとうございます。",
      "",
      "いまは 10 人ほどの招待制で、無料で試していただいています。順番に、招待のメール（件名「矢書への招待」）をお送りします。",
      "お送りできる時期は、まだ決まっていません。お待たせしてしまうこと、お送りできない場合があることを、ご了承ください。",
      "",
      "申し込みを取り消すときは、次のリンクを開いてください（取り消すと、お預かりしたメールアドレスと一言をすぐに消します）。",
      cancelUrl,
      "",
      "心当たりがない場合は、上のリンクから取り消すか、このメールを削除してください（招待のメールは届きません）。",
      "",
      "矢書 https://yabumi.app",
    ].join("\n"),
  };
}

export async function applyWaitlist(admin: Db, input: ApplyInput, deps: ApplyDeps): Promise<ApplyResult> {
  const now = deps.now?.() ?? new Date();
  // 人には見えない欄に何か入っていたら、ロボットとみなす（受け付けたふりもしない）
  if (input.honeypot.trim()) return { ok: false, reason: "bot" };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid_email" };
  if (deps.verifyTurnstile && !(await deps.verifyTurnstile(input.turnstileToken, input.ip))) return { ok: false, reason: "bot" };

  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const hash = input.ip ? ipHash(input.ip, deps.hashKey, now) : null;
  if (hash) {
    const { count } = await admin.from("waitlist").select("id", { count: "exact", head: true }).eq("ip_hash", hash).gt("created_at", hourAgo);
    if ((count ?? 0) >= PER_IP_PER_HOUR) return { ok: false, reason: "rate_limited" };
  }
  const { count: all } = await admin.from("waitlist").select("id", { count: "exact", head: true }).gt("created_at", hourAgo);
  if ((all ?? 0) >= ALL_PER_HOUR) return { ok: false, reason: "rate_limited" };

  const token = randomBytes(24).toString("base64url");
  const { error } = await admin
    .from("waitlist")
    .insert({ email, app_note: cleanNote(input.appNote), sns_note: cleanNote(input.snsNote), cancel_token_hash: sha256(token), ip_hash: hash, created_at: now.toISOString() });
  if (error) {
    // 申し込み済み（一意の制約）: 同じ返事にして、確認のメールは送り直さない（他人のアドレスに何度も送らせない）
    if (error.code === "23505") return { ok: true, mail: "none" };
    console.error("[waitlist] 申し込みを保存できませんでした", error.code, error.message);
    return { ok: false, reason: "failed" };
  }
  const mail = await (deps.sendMail ?? sendUserMail)(confirmationMail(email, `${deps.appUrl}/waitlist/cancel?t=${token}`), deps.mail);
  return { ok: true, mail };
}

// 確認のメールのリンクから、本人が取り消す。消したら true
export async function cancelWaitlist(admin: Db, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const { data, error } = await admin.from("waitlist").delete().eq("cancel_token_hash", sha256(token)).select("id");
  if (error) throw error;
  return data.length > 0;
}

export type WaitlistEntry = { id: string; email: string; appNote: string; snsNote: string; createdAt: string };

// 運営者の一覧（古い順。先に申し込んだ人から招待する）
export async function listWaitlist(admin: Db): Promise<WaitlistEntry[]> {
  const { data, error } = await admin.from("waitlist").select("id, email, app_note, sns_note, created_at").order("created_at").limit(500);
  if (error) throw error;
  return data.map((r) => ({ id: r.id, email: r.email, appNote: r.app_note, snsNote: r.sns_note, createdAt: r.created_at }));
}

export type InviteOutcome = { ok: true; already: boolean } | { ok: false; message: string };

// 招待する: Supabase の招待のメール（supabase/templates/invite.html。パスワードを決めて始める）を送り、申し込みを消す。
// すでに登録済みのアドレスなら、招待は送らずに申し込みだけを消す
export async function inviteFromWaitlist(admin: Db, id: string): Promise<InviteOutcome> {
  const { data: row } = await admin.from("waitlist").select("id, email").eq("id", id).maybeSingle();
  if (!row) return { ok: false, message: "申し込みが見つかりません。画面を読み込み直してください。" };
  const { error } = await admin.auth.admin.inviteUserByEmail(row.email);
  let already = false;
  if (error) {
    if (error.status === 422 || /already been registered|already registered|email_exists/i.test(`${error.code ?? ""} ${error.message}`)) already = true;
    else {
      console.error("[waitlist] 招待のメールを送れませんでした", error.status, error.message);
      return { ok: false, message: "招待のメールを送れませんでした。時間をおいてもう一度お試しください。" };
    }
  }
  await admin.from("waitlist").delete().eq("id", row.id);
  return { ok: true, already };
}

// お断りする: 申し込みを消す（メールは送らない）
export async function declineWaitlist(admin: Db, id: string): Promise<boolean> {
  const { data, error } = await admin.from("waitlist").delete().eq("id", id).select("id");
  if (error) throw error;
  return data.length > 0;
}

// Cloudflare Turnstile の確認（サーバー側）。https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
export async function verifyTurnstileToken(secret: string, token: string | null, ip: string | null, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (e) {
    console.error("[waitlist] Turnstile を確かめられませんでした", e instanceof Error ? e.message : e);
    return false;
  }
}
