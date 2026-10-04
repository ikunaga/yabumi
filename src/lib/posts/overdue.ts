import type { SupabaseClient } from "@supabase/supabase-js";
import { MANUAL_SNS_KEYS } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";

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

// 手で投稿する予定の時刻が来た（過ぎた）投稿の ID。概要で「手で投稿する番です」と知らせる
export async function dueManualPostIds(client: SupabaseClient<Database>, projectId: string, now = new Date(), limit = 5): Promise<string[]> {
  const { data, error } = await client
    .from("posts")
    .select("id, post_targets!inner(id)")
    .eq("project_id", projectId)
    .eq("status", "scheduled")
    .lte("planned_at", now.toISOString())
    .eq("post_targets.status", "pending")
    .in("post_targets.sns", MANUAL_SNS_KEYS)
    .order("planned_at")
    .limit(limit);
  if (error) throw error;
  return data.map((p) => p.id);
}
