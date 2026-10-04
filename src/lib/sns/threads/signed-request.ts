import { createHmac, timingSafeEqual } from "node:crypto";

// Meta から届くアンインストール・データ削除の通知（signed_request）を検証して中身を返す。
// 形式: <署名>.<中身>（どちらも base64url）。署名は「中身の文字列」をアプリシークレットで HMAC-SHA256 したもの
export type SignedRequestPayload = { user_id: string; algorithm: string; issued_at?: number };

export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestPayload | null {
  const [sig, payload] = signedRequest.split(".");
  if (!sig || !payload) return null;

  const expected = createHmac("sha256", appSecret).update(payload).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { user_id, algorithm, issued_at } = data as Record<string, unknown>;
  if (typeof algorithm !== "string" || algorithm.toUpperCase() !== "HMAC-SHA256") return null;
  if (typeof user_id !== "string" && typeof user_id !== "number") return null;
  return { user_id: String(user_id), algorithm, issued_at: typeof issued_at === "number" ? issued_at : undefined };
}
