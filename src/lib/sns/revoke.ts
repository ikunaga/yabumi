import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "@/lib/crypto/token-cipher";
import type { Database } from "@/lib/supabase/database.types";
import { refreshTokenAad } from "./accounts";

type Admin = SupabaseClient<Database>;

// SNS 側の連携を、アプリから解除できるものは解除する（SNS を外す・退会のとき。docs/architecture.md の 4.14）。
// X: トークンを X 側で取り消す。Threads: 解除する API がないので何もしない（画面で、Threads の設定から外せると案内する）。
// 失敗しても、矢書の側のトークンは呼ぶ側が消すので、それ以上は使われない。結果だけを返す
export type RevokeDeps = {
  key?: Buffer;
  revokeX?: (token: string, hint: "access_token" | "refresh_token") => Promise<void>;
};

export type RevokeResult = "revoked" | "not_supported" | "failed" | "no_token";

export async function revokeSnsAccess(admin: Admin, socialAccountId: string, sns: string, deps: RevokeDeps): Promise<RevokeResult> {
  if (sns !== "x") return "not_supported";
  if (!deps.revokeX) return "failed";
  const { data } = await admin
    .from("social_account_tokens")
    .select("access_token_encrypted, refresh_token_encrypted")
    .eq("social_account_id", socialAccountId)
    .maybeSingle();
  if (!data) return "no_token";
  try {
    if (data.refresh_token_encrypted) {
      await deps.revokeX(decryptToken(data.refresh_token_encrypted, refreshTokenAad(socialAccountId), deps.key), "refresh_token");
    }
    await deps.revokeX(decryptToken(data.access_token_encrypted, socialAccountId, deps.key), "access_token");
    return "revoked";
  } catch (e) {
    console.error("[sns] X のトークンを取り消せませんでした", e instanceof Error ? e.message : e);
    return "failed";
  }
}
