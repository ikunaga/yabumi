import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { BY_HAND_MESSAGE, type ByHandSns } from "@/lib/sns/by-hand";
import { SNS } from "@/lib/sns";

// 「X・TikTok は手で投稿する」を選んで保存した投稿のその SNS の配信先を、送らない印（失敗＋BY_HAND_MESSAGE）にする。
// 送信ジョブ（claim_due_targets）は送信待ち・準備中しか取り出さないので、自動では送らない（手で出したものと二重にならない）。
// 状態は利用者の権限では書けない列なので、サーバーが本人の投稿の配信先だけを書く。送った・送っている配信先は変えない
// 返り値: 印を付けた（またはその SNS の配信先がない）なら ok。送信ジョブがもう取り出していた（準備中・送信中）・送った・取り消したときは
// 書き換えずに、いまの状態を返す（セキュリティ確認 2026-11-13 の App-L2。そのまま「手で投稿する」と思わせると、手でも出して二重になる）
export type MarkByHandResult = { ok: true } | { ok: false; status: string };

export async function markByHand(admin: SupabaseClient<Database>, postId: string, ownerId: string, sns: ByHandSns): Promise<MarkByHandResult> {
  const { data, error } = await admin
    .from("post_targets")
    .update({ status: "failed", error_message: BY_HAND_MESSAGE[sns], next_attempt_at: null, locked_at: null })
    .eq("post_id", postId)
    .eq("owner_id", ownerId)
    .eq("sns", sns)
    .in("status", ["pending", "failed"])
    .select("id");
  if (error) throw error;
  if (data.length > 0) return { ok: true };
  const { data: t, error: readError } = await admin.from("post_targets").select("status").eq("post_id", postId).eq("owner_id", ownerId).eq("sns", sns).maybeSingle();
  if (readError) throw readError;
  return t ? { ok: false, status: t.status } : { ok: true };
}

// 印を付けられなかったときの知らせ（自動で送られる・送られた。手では出さない）
export function byHandTooLateMessage(sns: ByHandSns, status: string): string {
  const label = SNS[sns].label;
  return status === "published" || status === "deleted"
    ? `${label} にはもう送ってあったので、「手動で投稿する」にはしませんでした。二重にならないよう、${label} には手動で投稿しないでください。ほかの SNS は保存しました。`
    : `${label} はもう送信を始めていたので、「手動で投稿する」にはしませんでした。${label} には自動で送られます。二重にならないよう、手動では投稿しないでください。ほかの SNS は保存しました。`;
}
