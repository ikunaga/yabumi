import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { countUnsentDrafts } from "@/lib/posts/drafts";
import { NOT_X_BY_HAND_FILTER } from "@/lib/sns/x/send-rules";
import { addMonths, startOfYmd } from "@/lib/time";

// カレンダーの上の数字と右の列（見本 C）。いまあるデータだけで出す（DL・相関・空き枠は出さない。2026-10-30 の PM の回答）。
// 数は行を読まずに DB で数える（head の count）
export type CalendarStats = {
  // この月（週の表示はこの週）に予約していて、まだ送っていない投稿
  scheduled: number;
  // この月（週の表示はこの週）に送った投稿
  posted: number;
  // 下書き（日付の有無を問わない）
  drafts: number;
  // 送れなかった SNS がある投稿（いつのものでも。直すか送り直すまで残る）
  failed: number;
  // そのうち 1 件の投稿の id（1 件だけのとき、カードからその投稿を開く）
  failedPostId: string | null;
  // この月（週の表示はこの週）の SNS ごとの本数（予約と投稿済み）。0 の SNS は入れない
  bySns: { sns: SnsKey; count: number }[];
};

// db を渡すと、そのクライアントで読む（テストでは利用者の権限のクライアントを渡す）
// 月の表示: その月で数える
export async function loadCalendarStats(projectId: string, ym: string, db?: SupabaseClient<Database>): Promise<CalendarStats> {
  return loadCalendarStatsBetween(projectId, `${ym}-01`, `${addMonths(ym, 1)}-01`, db);
}

// 期間で数える（from から to の前の日まで。日本時間の YYYY-MM-DD）。週の表示は、表示している週で数える
// （前は今週なら今月、ほかの週は木曜の月で数え、11/30〜12/6 の週で 11/30 の予約が「12 月の予約 0 件」になった。2026-11-13 PMO2 の確かめ）
export async function loadCalendarStatsBetween(projectId: string, fromYmd: string, toYmdExclusive: string, db?: SupabaseClient<Database>): Promise<CalendarStats> {
  const supabase = db ?? (await createClient());
  const from = startOfYmd(fromYmd).toISOString();
  const to = startOfYmd(toYmdExclusive).toISOString();
  const head = { count: "exact", head: true } as const;

  const [scheduled, posted, drafts, failed, failedOne, ...bySns] = await Promise.all([
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
    // 下書きは、まだどこにも送っていないもの（今すぐ送った投稿は draft のまま。下書きの一覧と同じ決め方）
    countUnsentDrafts(supabase, projectId),
    supabase
      .from("posts")
      .select("id, post_targets!inner(id)", head)
      .eq("project_id", projectId)
      .eq("post_targets.status", "failed")
      // 「X は手で投稿する」を選んだ X は、失敗に数えない
      .or(NOT_X_BY_HAND_FILTER, { referencedTable: "post_targets" }),
    supabase
      .from("posts")
      .select("id, post_targets!inner(id)")
      .eq("project_id", projectId)
      .eq("post_targets.status", "failed")
      .or(NOT_X_BY_HAND_FILTER, { referencedTable: "post_targets" })
      .order("updated_at", { ascending: false })
      .limit(1),
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
  for (const r of [scheduled, posted, failed, failedOne, ...bySns]) if (r.error) throw r.error;

  return {
    scheduled: scheduled.count ?? 0,
    posted: posted.count ?? 0,
    drafts,
    failed: failed.count ?? 0,
    failedPostId: failedOne.data?.[0]?.id ?? null,
    bySns: SNS_KEYS.map((sns, i) => ({ sns, count: bySns[i].count ?? 0 }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}
