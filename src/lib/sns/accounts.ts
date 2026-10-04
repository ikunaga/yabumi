import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptToken } from "@/lib/crypto/token-cipher";
import type { Database } from "@/lib/supabase/database.types";
import type { SnsKey } from "./index";

// SNS アカウントとトークンの保存・削除。RLS を通らないクライアント（createAdminClient）で呼ぶ。
// owner_id は必ずサーバーで確かめたログイン中の利用者を渡す。
type Admin = SupabaseClient<Database>;

export type ConnectedAccount = {
  ownerId: string;
  sns: SnsKey;
  externalId: string;
  displayName: string;
  handle: string;
  accessToken: string;
  expiresAt: Date | null;
  scopes: readonly string[];
};

// つなぐ・つなぎ直す。同じ利用者が同じアカウントをつなぎ直したときは行を作り直さず更新する
export async function saveConnectedAccount(admin: Admin, a: ConnectedAccount, key?: Buffer): Promise<string> {
  const { data, error } = await admin
    .from("social_accounts")
    .upsert(
      {
        owner_id: a.ownerId,
        sns: a.sns,
        external_id: a.externalId,
        display_name: a.displayName,
        handle: a.handle,
        status: "active",
      },
      { onConflict: "owner_id,sns,external_id" },
    )
    .select("id")
    .single();
  if (error) throw error;

  // 行の ID を付けて暗号化し、別の行のトークンと差し替えられないようにする
  const { error: tokenError } = await admin.from("social_account_tokens").upsert({
    social_account_id: data.id,
    access_token_encrypted: encryptToken(a.accessToken, data.id, key),
    refresh_token_encrypted: null,
    expires_at: a.expiresAt?.toISOString() ?? null,
    scopes: [...a.scopes],
  });
  if (tokenError) throw tokenError;
  return data.id;
}

// SNS 側でアプリが外されたとき。アカウントは残し（過去の投稿の記録のため）、トークンだけ消す
export async function revokeAccountsByExternalId(admin: Admin, sns: SnsKey, externalId: string): Promise<number> {
  const { data, error } = await admin
    .from("social_accounts")
    .update({ status: "revoked" })
    .eq("sns", sns)
    .eq("external_id", externalId)
    .select("id");
  if (error) throw error;
  const ids = data.map((r) => r.id);
  if (ids.length) {
    const { error: delError } = await admin.from("social_account_tokens").delete().in("social_account_id", ids);
    if (delError) throw delError;
  }
  return ids.length;
}

// SNS 側でデータの削除を求められたとき。アカウントとトークンを消す（配信先からの参照は空になる）
export async function deleteAccountsByExternalId(admin: Admin, sns: SnsKey, externalId: string): Promise<number> {
  const { data, error } = await admin.from("social_accounts").delete().eq("sns", sns).eq("external_id", externalId).select("id");
  if (error) throw error;
  return data.length;
}
