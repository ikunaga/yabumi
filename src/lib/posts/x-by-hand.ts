import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { X_BY_HAND_MESSAGE } from "@/lib/sns/x/send-rules";

// 「X は手で投稿する」を選んで保存した投稿の X の配信先を、送らない印（失敗＋X_BY_HAND_MESSAGE）にする。
// 送信ジョブ（claim_due_targets）は送信待ち・準備中しか取り出さないので、月が替わって上限が空いても自動では送らない（手で出したものと二重にならない）。
// 状態は利用者の権限では書けない列なので、サーバーが本人の投稿の X の配信先だけを書く。送った・送っている配信先は変えない
export async function markXByHand(admin: SupabaseClient<Database>, postId: string, ownerId: string): Promise<void> {
  const { error } = await admin
    .from("post_targets")
    .update({ status: "failed", error_message: X_BY_HAND_MESSAGE, next_attempt_at: null, locked_at: null })
    .eq("post_id", postId)
    .eq("owner_id", ownerId)
    .eq("sns", "x")
    .in("status", ["pending", "failed"]);
  if (error) throw error;
}
