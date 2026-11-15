import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { revokeAccountsByIds } from "@/lib/sns/accounts";
import { SnsPublishError, type SnsAdapter } from "@/lib/sns/adapters/types";
import { loadAccount } from "@/lib/sns/publisher";
import { TikTokApiError, fetchUser } from "./api";

// TikTok の Webhook（docs/design/tiktok.md の 12.。使うのは authorization.removed だけ。0. の D）。
// 署名を確かめたうえで、中身は信じない。届いた open_id のアカウントごとに、こちらからトークンでユーザー情報を読み、
// 使えなくなっていたときだけ外す（届いた通知だけで外すと、署名の鍵が漏れたときに他人のつながりを切られる）
type Admin = SupabaseClient<Database>;

// 署名の時刻と今の差の許容（資料にないので 5 分。docs/design/tiktok.md の「確かめた窓口」）
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

// TikTok-Signature: t=<時刻（秒）>,s=<HMAC-SHA256 の hex>。署名する文字列は「t + "." + 受け取った本文のまま」、鍵は client_secret
export function verifyTikTokSignature(header: string | null, rawBody: string, secret: string, now = new Date()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = parts.t;
  const s = parts.s;
  if (!t || !/^\d{1,12}$/.test(t) || !s || !/^[0-9a-f]{64}$/i.test(s)) return false;
  if (Math.abs(now.getTime() - Number(t) * 1000) > SIGNATURE_TOLERANCE_MS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest();
  const given = Buffer.from(s, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type TikTokWebhookDeps = {
  adapter: SnsAdapter | undefined;
  clientKey: string;
  // テストで差し替える（既定は TikTok のユーザー情報を読む）
  stillAuthorized?: (accessToken: string) => Promise<boolean>;
  key?: Buffer;
  now?: () => Date;
};

// トークンでユーザー情報を読めるか。401・access_token_invalid なら外された。そのほかの失敗（TikTok の障害・通信）は投げる（Webhook をやり直してもらう）
async function defaultStillAuthorized(accessToken: string): Promise<boolean> {
  try {
    await fetchUser(accessToken);
    return true;
  } catch (e) {
    if (e instanceof TikTokApiError && (e.status === 401 || e.code === "access_token_invalid")) return false;
    throw e;
  }
}

export type WebhookOutcome = { handled: "ignored" | "checked"; revoked: number };

// 本文を読んで、外されたアカウントだけを外す。何度届いても同じ結果になる
export async function handleTikTokWebhook(admin: Admin, rawBody: string, deps: TikTokWebhookDeps): Promise<WebhookOutcome> {
  let body: { client_key?: unknown; event?: unknown; user_openid?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { handled: "ignored", revoked: 0 };
  }
  if (body.client_key !== deps.clientKey || body.event !== "authorization.removed" || typeof body.user_openid !== "string" || !body.user_openid || body.user_openid.length > 200) {
    return { handled: "ignored", revoked: 0 };
  }
  const { data: accounts, error } = await admin.from("social_accounts").select("id, external_id").eq("sns", "tiktok").eq("external_id", body.user_openid).neq("status", "revoked");
  if (error) throw error;
  const stillAuthorized = deps.stillAuthorized ?? defaultStillAuthorized;
  const removed: string[] = [];
  for (const a of accounts) {
    let account;
    try {
      account = await loadAccount(admin, a.id, a.external_id, { key: deps.key, now: deps.now }, deps.adapter);
    } catch (e) {
      // 取り直しで「つながりが切れている」と言われたら、外されたと見なす
      if (e instanceof SnsPublishError && e.kind === "auth") {
        removed.push(a.id);
        continue;
      }
      throw e;
    }
    // トークンがない（期限切れで読めない）なら、もう使えない
    if (!account || !(await stillAuthorized(account.accessToken))) removed.push(a.id);
  }
  return { handled: "checked", revoked: await revokeAccountsByIds(admin, removed) };
}
