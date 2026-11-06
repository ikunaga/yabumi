import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadGoals, metricTotal, type GoalsView } from "./load";
import type { GoalKpi, MetricTotal } from "./schema";

// 画面で使う（ログイン中の利用者の権限で読む。RLS で本人のものだけ）
export async function getGoals(projectId: string): Promise<GoalsView> {
  return loadGoals(await createClient(), projectId);
}

// KPI の週の数（from〜to。KPI の id ごと）。数えるのは DB の goal_metric_total
export async function kpiWeekTotals(projectId: string, kpis: GoalKpi[], from: string, to: string): Promise<Map<string, MetricTotal>> {
  const db = await createClient();
  const totals = await Promise.all(kpis.map((k) => metricTotal(db, projectId, k, from, to)));
  return new Map(kpis.map((k, i) => [k.id, totals[i]]));
}
