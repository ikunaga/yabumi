import type { SnsKey } from "@/lib/sns";
import { insightsEnabled } from "@/lib/sns/insights/scopes";

// 回し方の画面の、配信先ごとの数字の状態（2026-11-28）。views が null のときに、なぜないかを出すため
// off = この SNS の数字は読んでいない、waiting = まだ読む日が来ていない（firstRead は最初に読む朝）、missing = 読む日は来たが、まだ入っていない
export type MetricsState = { state: "has" } | { state: "off" } | { state: "waiting"; firstRead: string } | { state: "missing" };

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;
// 数字を最初に読む朝（送ってから 24 時間たったあとの、日本時間 5 時。ジョブは毎朝 5:00〜5:50）
export function firstMetricsRead(publishedAt: Date): Date {
  const ready = publishedAt.getTime() + DAY_MS;
  const jst = new Date(ready + JST_MS);
  let at = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 5) - JST_MS;
  if (at < ready) at += DAY_MS;
  return new Date(at);
}

export function metricsState(sns: SnsKey, publishedAt: string | null, views: number | null, now: Date, env?: string): MetricsState {
  if (views !== null) return { state: "has" };
  if (!insightsEnabled(sns, env)) return { state: "off" };
  if (!publishedAt) return { state: "missing" };
  const first = firstMetricsRead(new Date(publishedAt));
  // 最初の朝のジョブ（5:00〜5:50）が終わるまでは、まだ読む日が来ていない
  return now.getTime() < first.getTime() + 3_600_000 ? { state: "waiting", firstRead: first.toISOString() } : { state: "missing" };
}

