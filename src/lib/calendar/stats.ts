import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { addMonths, startOfYmd } from "@/lib/time";

// カレンダーの上の数字と右の列（見本 C）。いまあるデータだけで出す（DL・相関・空き枠は出さない。2026-10-30 の PM の回答）。
// 数は行を読まずに DB で数える（head の count）
export type CalendarStats = {
  // この月に予約していて、まだ送っていない投稿
  scheduled: number;
  // この月に送った投稿
  posted: number;
  // 下書き（日付の有無を問わない）
  drafts: number;
  // 送れなかった SNS がある投稿（いつのものでも。直すか送り直すまで残る）
  failed: number;
  // この月の SNS ごとの本数（予約と投稿済み）。0 の SNS は入れない
  bySns: { sns: SnsKey; count: number }[];
};

// db を渡すと、そのクライアントで読む（テストでは利用者の権限のクライアントを渡す）
export async function loadCalendarStats(projectId: string, ym: string, db?: SupabaseClient<Database>): Promise<CalendarStats> {
  const supabase = db ?? (await createClient());
  const from = startOfYmd(`${ym}-01`).toISOString();
  const to = startOfYmd(`${addMonths(ym, 1)}-01`).toISOString();
  const head = { count: "exact", head: true } as const;

  const [scheduled, posted, drafts, failed, ...bySns] = await Promise.all([
    supabase
      .from("posts")
      .select("id, post_targets!inner(id)", head)
      .eq("project_id", projectId)
      .eq("status", "scheduled")
      .gte("planned_at", from)
      .lt("planned_at", to)
      .eq("post_targets.status", "pending"),
    supabase
      .from("posts")
      .select("id, post_targets!inner(id)", head)
      .eq("project_id", projectId)
      .eq("post_targets.status", "published")
      .gte("post_targets.published_at", from)
      .lt("post_targets.published_at", to),
    supabase.from("posts").select("id", head).eq("project_id", projectId).eq("status", "draft"),
    supabase.from("posts").select("id, post_targets!inner(id)", head).eq("project_id", projectId).eq("post_targets.status", "failed"),
    ...SNS_KEYS.map((sns) =>
      supabase
        .from("post_targets")
        .select("id, posts!inner(id)", head)
        .eq("sns", sns)
        .eq("posts.project_id", projectId)
        .eq("posts.status", "scheduled")
        .in("status", ["pending", "preparing", "publishing", "published"])
        .gte("posts.planned_at", from)
        .lt("posts.planned_at", to),
    ),
  ]);
  for (const r of [scheduled, posted, drafts, failed, ...bySns]) if (r.error) throw r.error;

  return {
    scheduled: scheduled.count ?? 0,
    posted: posted.count ?? 0,
    drafts: drafts.count ?? 0,
    failed: failed.count ?? 0,
    bySns: SNS_KEYS.map((sns, i) => ({ sns, count: bySns[i].count ?? 0 }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}
