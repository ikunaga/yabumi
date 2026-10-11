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
  // リフレッシュトークンで取り直す SNS（X）だけ
  refreshToken?: string | null;
  expiresAt: Date | null;
  scopes: readonly string[];
  // Facebook ページのとき、そのページをつないだ Facebook の利用者の ID（外す・削除の通知に使う）
  parentExternalId?: string | null;
};

// リフレッシュトークンは行の ID に ":refresh" を足したものを追加認証データにして暗号化する（アクセストークンと入れ替えられないように）
export const refreshTokenAad = (socialAccountId: string) => `${socialAccountId}:refresh`;

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
        parent_external_id: a.parentExternalId ?? null,
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
    refresh_token_encrypted: a.refreshToken ? encryptToken(a.refreshToken, refreshTokenAad(data.id), key) : null,
    refresh_locked_until: null,
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
    // SNS の側でアクセスを取り消されたので、その SNS から受け取ったものも消す（4.14）
    await purgeSnsDataOf(admin, ids);
  }
  return ids.length;
}

// SNS 側でデータの削除を求められたとき。アカウントとトークンを消す（配信先からの参照は空になる）
export async function deleteAccountsByExternalId(admin: Admin, sns: SnsKey, externalId: string): Promise<number> {
  const { data: found, error: e1 } = await admin.from("social_accounts").select("id").eq("sns", sns).eq("external_id", externalId);
  if (e1) throw e1;
  await purgeSnsDataOf(admin, found.map((r) => r.id));
  const { data, error } = await admin.from("social_accounts").delete().eq("sns", sns).eq("external_id", externalId).select("id");
  if (error) throw error;
  return data.length;
}

// アクセスがなくなったとき（矢書の「外す」、SNS の側で外された、データの削除を求められた）に、その SNS から受け取ったものを消す:
// 送った投稿の数字（post_metrics）とフォロワーの数（account_metrics）、SNS 上の投稿の ID・URL・送信の途中の情報。
// 投稿の本文と「送った」という記録は利用者が書いたものなので残す。X の Developer Policy と Meta の Platform Terms に合わせ、
// どの SNS も同じ扱いにする（docs/architecture.md の 4.14、プライバシーポリシーの第 5・6 条）
export async function purgeSnsDataOf(admin: Admin, socialAccountIds: string[]): Promise<void> {
  if (!socialAccountIds.length) return;
  const { error: e0 } = await admin.from("account_metrics").delete().in("social_account_id", socialAccountIds);
  if (e0) throw e0;
  const { data: targets, error } = await admin.from("post_targets").select("id").in("social_account_id", socialAccountIds);
  if (error) throw error;
  const ids = targets.map((t) => t.id);
  if (!ids.length) return;
  const { error: e1 } = await admin.from("post_metrics").delete().in("post_target_id", ids);
  if (e1) throw e1;
  const { error: e2 } = await admin.from("post_targets").update({ external_post_id: null, external_url: null, sns_container: null }).in("id", ids);
  if (e2) throw e2;
}

// Facebook の側で矢書が外されたとき。その Facebook の利用者がつないだページを、すべて「解除済み」にしてトークンを消す
export async function revokeAccountsByParentId(admin: Admin, sns: SnsKey, parentExternalId: string): Promise<number> {
  const { data, error } = await admin
    .from("social_accounts")
    .update({ status: "revoked" })
    .eq("sns", sns)
    .eq("parent_external_id", parentExternalId)
    .select("id");
  if (error) throw error;
  const ids = data.map((r) => r.id);
  if (ids.length) {
    const { error: delError } = await admin.from("social_account_tokens").delete().in("social_account_id", ids);
    if (delError) throw delError;
    // SNS の側でアクセスを取り消されたので、その SNS から受け取ったものも消す（4.14）
    await purgeSnsDataOf(admin, ids);
  }
  return ids.length;
}

// Facebook の側でデータの削除を求められたとき。その人がつないだページのアカウントとトークンを消す
export async function deleteAccountsByParentId(admin: Admin, sns: SnsKey, parentExternalId: string): Promise<number> {
  const { data: found, error: e1 } = await admin.from("social_accounts").select("id").eq("sns", sns).eq("parent_external_id", parentExternalId);
  if (e1) throw e1;
  await purgeSnsDataOf(admin, found.map((r) => r.id));
  const { data, error } = await admin.from("social_accounts").delete().eq("sns", sns).eq("parent_external_id", parentExternalId).select("id");
  if (error) throw error;
  return data.length;
}
