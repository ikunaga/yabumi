import { slotLabel } from "@/lib/overview/numbers";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { addDays, formatTime, toYmd } from "@/lib/time";
import { STOP_REASON_TEXT } from "./labels";
import type { AutoPlan, UpcomingAutoRun } from "./types";

// 自動の投稿の入口（docs/design/auto-post.md の 1.2）。概要の 1 行の帯を、DB に触れずに決める

export type OverviewAutoBand = {
  active: number; // 運用中の回し方
  paused: number; // 利用者が止めた回し方
  next: { label: string; sns: SnsKey[] } | null; // 次の回（「明日 09:00」と送り先）
  review: number; // 確認待ち
  stopped: { id: string; name: string; reason: string }[]; // yabumi が止めた回し方（要確認）
  held?: boolean; // 運営者が、利用者ごとに自動投稿を止めている（要確認。概要が auto_post_holds から足す）
};

// 帯に出す次の回は、14 日先まで（listUpcomingAutoRuns に渡す範囲）
export const BAND_LOOKAHEAD_DAYS = 14;

// 次の回の時刻（「今日 18:00」「明日 09:00」「11/20 19:00」）
export function nextRunLabel(iso: string, now: Date): string {
  return toYmd(new Date(iso)) === toYmd(now) ? `今日 ${formatTime(iso)}` : slotLabel(iso, now);
}

// 回し方が 1 つもなければ null（帯を出さない）
export function overviewAutoBand(plans: AutoPlan[], upcoming: UpcomingAutoRun[], review: number, now: Date = new Date()): OverviewAutoBand | null {
  if (plans.length === 0) return null;
  const activeIds = new Set(plans.filter((p) => p.status === "active").map((p) => p.id));
  const runs = upcoming.filter((r) => activeIds.has(r.planId) && new Date(r.dueAt) > now && !["held", "skipped", "canceled"].includes(r.status));
  const first = runs.reduce<string | null>((min, r) => (min === null || r.dueAt < min ? r.dueAt : min), null);
  let next: OverviewAutoBand["next"] = null;
  if (first) {
    // 同じ時刻の回が複数あれば、送り先をまとめる
    const at = new Date(first).getTime();
    const sns = new Set(runs.filter((r) => new Date(r.dueAt).getTime() === at).flatMap((r) => r.sns));
    next = { label: nextRunLabel(first, now), sns: SNS_KEYS.filter((k) => sns.has(k)) };
  }
  return {
    active: activeIds.size,
    paused: plans.filter((p) => p.status === "paused").length,
    next,
    review,
    stopped: plans
      .filter((p) => p.status === "stopped")
      .map((p) => ({ id: p.id, name: p.name, reason: p.stopReason ? STOP_REASON_TEXT[p.stopReason] : "止まりました" })),
  };
}

// 概要で読む次の回の範囲（今から 14 日）
export function bandRange(now: Date = new Date()): { from: Date; until: Date } {
  return { from: now, until: new Date(`${addDays(toYmd(now), BAND_LOOKAHEAD_DAYS + 1)}T00:00:00+09:00`) };
}
