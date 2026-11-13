import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { X_BY_HAND_MESSAGE } from "@/lib/sns/x/send-rules";

// 「X は手で投稿する」を選んで保存した投稿の X の配信先を、送らない印（失敗＋X_BY_HAND_MESSAGE）にする。
// 送信ジョブ（claim_due_targets）は送信待ち・準備中しか取り出さないので、月が替わって上限が空いても自動では送らない（手で出したものと二重にならない）。
// 状態は利用者の権限では書けない列なので、サーバーが本人の投稿の X の配信先だけを書く。送った・送っている配信先は変えない
// 返り値: 印を付けた（または X の配信先がない）なら ok。送信ジョブがもう X を取り出していた（準備中・送信中）・送った・取り消したときは
// 書き換えずに、いまの状態を返す（セキュリティ確認 2026-11-13 の App-L2。そのまま「手で投稿する」と思わせると、手でも出して二重になる）
export type MarkXByHandResult = { ok: true } | { ok: false; status: string };

export async function markXByHand(admin: SupabaseClient<Database>, postId: string, ownerId: string): Promise<MarkXByHandResult> {
  const { data, error } = await admin
    .from("post_targets")
    .update({ status: "failed", error_message: X_BY_HAND_MESSAGE, next_attempt_at: null, locked_at: null })
    .eq("post_id", postId)
    .eq("owner_id", ownerId)
    .eq("sns", "x")
    .in("status", ["pending", "failed"])
    .select("id");
  if (error) throw error;
  if (data.length > 0) return { ok: true };
  const { data: x, error: readError } = await admin.from("post_targets").select("status").eq("post_id", postId).eq("owner_id", ownerId).eq("sns", "x").maybeSingle();
  if (readError) throw readError;
  return x ? { ok: false, status: x.status } : { ok: true };
}

// 印を付けられなかったときの知らせ（X は自動で送られる・送られた。手では出さない）
export function xByHandTooLateMessage(status: string): string {
  return status === "published" || status === "deleted"
    ? "X にはもう送ってあったので、「手で投稿する」にはしませんでした。X には手で出さないでください（二重になります）。ほかの SNS は保存しました。"
    : "X はもう送信を始めていたので、「手で投稿する」にはしませんでした。X には自動で送られます。手では出さないでください（二重になります）。ほかの SNS は保存しました。";
}
