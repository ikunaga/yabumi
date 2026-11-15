import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { purgeSnsDataOf } from "@/lib/sns/accounts";

// Google の設定で取り消されたなどで期限切れになった YouTube のアカウントを、30 日つなぎ直されなければ片付ける（docs/design/youtube.md の 2.4・9.）。
// 開発者ポリシー「Google の設定で取り消されたら 30 日以内に消す」。期限切れにした時刻は social_accounts.updated_at（expired にした更新）。
// トークンを消し、送った動画の ID・アップロードの途中の情報・同意の記録（チャンネル名）を消す。アカウントの行は「期限切れ」のまま残す（過去の投稿の記録のため）
export const EXPIRED_PURGE_DAYS = 29;

type Admin = SupabaseClient<Database>;

export async function purgeExpiredYouTube(admin: Admin, now = new Date(), onlyOwner?: string): Promise<string[]> {
  const before = new Date(now.getTime() - EXPIRED_PURGE_DAYS * 86400_000).toISOString();
  // トークンが残っているものだけ（片付けたものは二度と拾わない）
  let query = admin
    .from("social_accounts")
    .select("id, social_account_tokens!inner(social_account_id)")
    .eq("sns", "youtube")
    .eq("status", "expired")
    .lt("updated_at", before)
    .limit(200);
  if (onlyOwner) query = query.eq("owner_id", onlyOwner);
  const { data, error } = await query;
  if (error) throw error;
  const ids = (data ?? []).map((a) => a.id);
  if (!ids.length) return [];
  await purgeSnsDataOf(admin, ids);
  const { error: e2 } = await admin.from("social_account_tokens").delete().in("social_account_id", ids);
  if (e2) throw e2;
  return ids;
}
