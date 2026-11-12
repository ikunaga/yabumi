import type { SupabaseClient } from "@supabase/supabase-js";
import { MANUAL_SNS_KEYS } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { X_BY_HAND_MESSAGE } from "@/lib/sns/x/send-rules";

// 送信ジョブは毎分動く。予約時刻をこれだけ過ぎても送られていなければ、ジョブか Supabase が止まっていると考える
export const OVERDUE_MINUTES = 10;

// 予約時刻を過ぎても送られていない配信先がある投稿の ID（RLS で本人のものだけ）
export async function overduePostIds(client: SupabaseClient<Database>, projectId: string, now = new Date(), limit = 5): Promise<string[]> {
  const cutoff = new Date(now.getTime() - OVERDUE_MINUTES * 60_000).toISOString();
  const { data, error } = await client
    .from("posts")
    .select("id, post_targets!inner(id)")
    .eq("project_id", projectId)
    .eq("status", "scheduled")
    .lt("planned_at", cutoff)
    .eq("post_targets.status", "pending")
    // 手で投稿する SNS は予約ジョブが送らないので、ここでは数えない（別に「手で投稿する番」として出す）
    .not("post_targets.sns", "in", `(${MANUAL_SNS_KEYS.join(",")})`)
    // やり直しを待っているものは、待ち時間が過ぎてからさらに 10 分たったら数える
    .or(`next_attempt_at.is.null,next_attempt_at.lt.${cutoff}`, { referencedTable: "post_targets" })
    .order("planned_at")
    .limit(limit);
  if (error) throw error;
  return data.map((p) => p.id);
}

// 手で投稿する予定の時刻が来た（過ぎた）投稿の ID。概要で「手で投稿する番です」と知らせる。
// 手で投稿する SNS（note・Substack）の送る前のものと、「X は手で投稿する」を選んだ X（ほかの SNS を送る時刻が来たら。利用者が忘れないように）
export async function dueManualPostIds(client: SupabaseClient<Database>, projectId: string, now = new Date(), limit = 5): Promise<string[]> {
  const base = () =>
    client.from("posts").select("id, planned_at, post_targets!inner(id)").eq("project_id", projectId).eq("status", "scheduled").lte("planned_at", now.toISOString());
  const [manual, xHand] = await Promise.all([
    base().eq("post_targets.status", "pending").in("post_targets.sns", MANUAL_SNS_KEYS).order("planned_at").limit(limit),
    base().eq("post_targets.sns", "x").eq("post_targets.status", "failed").eq("post_targets.error_message", X_BY_HAND_MESSAGE).order("planned_at").limit(limit),
  ]);
  if (manual.error) throw manual.error;
  if (xHand.error) throw xHand.error;
  const rows = [...new Map([...manual.data, ...xHand.data].map((p) => [p.id, p])).values()];
  return rows
    .sort((a, b) => (a.planned_at ?? "").localeCompare(b.planned_at ?? ""))
    .slice(0, limit)
    .map((p) => p.id);
}
