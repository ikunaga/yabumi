import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { addDays, weekdayOf } from "@/lib/time";
import type { PlanData } from "@/lib/plan/schema";

// 伴走（F18、決定 D29。docs/architecture.md の 4.27）のペースの計算。画面・毎日のジョブ・メールが同じ計算を使う。
// 数は DB の counted_post_targets（送信済みは送った日、予約済みは予約の日。日本時間）。週は日本時間の月曜から

export const CYCLE_WEEKS = 4;
export const DEFAULT_BEHIND_WEEKDAY = 3;

export type WeeklyTargets = Partial<Record<SnsKey, number>>;
export type SnsCounts = Partial<Record<SnsKey, { published: number; scheduled: number }>>;

// done: 送信済みで届いた / on_track: 予約を入れれば届く / behind: 遅れそう / not_yet: まだ（週の初めなど）/ missed: 終わった週で届かなかった
export type PaceStatus = "done" | "on_track" | "behind" | "not_yet" | "missed";

export type SnsPace = { sns: SnsKey; target: number; published: number; scheduled: number; remaining: number; status: PaceStatus };

export type WeekPace = {
  weekStart: string;
  rows: SnsPace[];
  // すべての SNS で送信済みが届いた
  achieved: boolean;
  // すべての SNS で、予約を入れれば届く（達成を含む）
  covered: boolean;
  // 遅れそうな SNS がある
  behind: boolean;
};

// 月曜 = 1 … 日曜 = 7
export function isoWeekday(ymd: string): number {
  return ((weekdayOf(ymd) + 6) % 7) + 1;
}

export function hasTargets(targets: WeeklyTargets): boolean {
  return SNS_KEYS.some((s) => (targets[s] ?? 0) > 0);
}

// 1 つの SNS の状態。遅れそう: 決めた曜日を過ぎても 1 本もない（送信済み＋予約済み）、残りの日数より足りない本数が多い、または土日でまだ足りない
export function snsStatus(a: { target: number; published: number; scheduled: number }, today: string, weekStart: string, behindWeekday = DEFAULT_BEHIND_WEEKDAY): PaceStatus {
  if (a.published >= a.target) return "done";
  const weekEnd = addDays(weekStart, 6);
  if (today > weekEnd) return "missed";
  if (a.published + a.scheduled >= a.target) return "on_track";
  const dow = today < weekStart ? 0 : isoWeekday(today);
  const need = a.target - a.published - a.scheduled;
  const daysLeft = 8 - Math.max(dow, 1);
  if ((dow >= behindWeekday && a.published + a.scheduled === 0) || need > daysLeft || dow >= 6) return "behind";
  return "not_yet";
}

export function computeWeekPace(args: { targets: WeeklyTargets; counts: SnsCounts; today: string; weekStart: string; behindWeekday?: number }): WeekPace {
  const rows: SnsPace[] = SNS_KEYS.filter((s) => (args.targets[s] ?? 0) > 0).map((sns) => {
    const target = args.targets[sns]!;
    const published = args.counts[sns]?.published ?? 0;
    const scheduled = args.counts[sns]?.scheduled ?? 0;
    return { sns, target, published, scheduled, remaining: Math.max(0, target - published - scheduled), status: snsStatus({ target, published, scheduled }, args.today, args.weekStart, args.behindWeekday) };
  });
  return {
    weekStart: args.weekStart,
    rows,
    achieved: rows.length > 0 && rows.every((r) => r.status === "done"),
    covered: rows.length > 0 && rows.every((r) => r.status === "done" || r.status === "on_track"),
    behind: rows.some((r) => r.status === "behind"),
  };
}

// 「X 1 本・Instagram 1 本」（予約を入れても足りない分）
export function remainingText(p: WeekPace): string {
  return p.rows
    .filter((r) => r.remaining > 0)
    .map((r) => `${SNS[r.sns].label} ${r.remaining} 本`)
    .join("・");
}

// 遅れそうなときのメール・通知を送るか（決めた曜日の朝に、今週まだ 1 本もない SNS があるとき。オーナーの決定の既定は水曜）
export function shouldNudgeBehind(p: WeekPace, today: string, behindWeekday: number): boolean {
  return isoWeekday(today) === behindWeekday && p.rows.some((r) => r.published + r.scheduled === 0 && r.status !== "done");
}

// 続けた週: 先週からさかのぼって、続けて目標に届いた週の数。今週がもう届いていれば足す
export function streakWeeks(past: { weekStart: string; achieved: boolean }[], thisWeek: string, thisWeekAchieved: boolean): number {
  const byWeek = new Map(past.map((w) => [w.weekStart, w.achieved]));
  let n = 0;
  for (let w = addDays(thisWeek, -7); byWeek.get(w) === true; w = addDays(w, -7)) n++;
  return n + (thisWeekAchieved ? 1 : 0);
}

// ===== 1 か月（4 週）の区切り =====
export type CycleInfo = { startedOn: string; endsOn: string; weekIndex: number; ended: boolean };

export function cycleInfo(startedOn: string, today: string): CycleInfo {
  const endsOn = addDays(startedOn, CYCLE_WEEKS * 7 - 1);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / 86_400_000);
  return { startedOn, endsOn, weekIndex: Math.min(CYCLE_WEEKS, Math.max(1, Math.floor(days / 7) + 1)), ended: today > endsOn };
}

// その日を含む週の月曜
export function mondayOf(ymd: string): string {
  return addDays(ymd, 1 - isoWeekday(ymd));
}

// 最初の 1 か月を保存するときの数え始めの日: 週の回数を初めて決めたとき、1 か月が終わったあと、または「次の 1 か月を始める」のとき、今週の月曜から。
// ほかは前の日のまま（画面や AI の案は数え始めの日を送らない）
export function withFirstMonthCycle(next: PlanData["first_month"], prev: PlanData["first_month"] | null, today: string, restart = false): PlanData["first_month"] {
  if (!hasTargets(next.weekly)) return { ...next, startedOn: prev?.startedOn ?? null };
  const started = prev?.startedOn ?? null;
  const fresh = !started || restart || cycleInfo(started, today).ended;
  return { ...next, startedOn: fresh ? mondayOf(today) : started };
}
