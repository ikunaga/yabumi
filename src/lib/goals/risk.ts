import { addDays } from "@/lib/time";
import type { GoalProgress } from "./load";
import type { Goal, GoalMetric } from "./schema";
import { formatMetric } from "./view";

// 目標（KGI）に届かない見込みの判定と、AI なしで選べる見直しの案（2026-11-19 オーナーの決定。docs/design/goals-model.md の 13.）。
// 数は DB の goal_metric_total が数えたもの（progressOf）だけを使う。画面とサーバーの操作が同じ計算を使う

// 数え始めてから、この日数がたつまでは判定しない（始めたばかりの上下で騒がない）
export const RISK_MIN_DAYS = 14;
// 見込み ÷ 目標がこれ未満なら「このままでは届かない」（1 未満は「届かないかも」）
export const RISK_OFF_RATIO = 0.7;
// 期限をのばすのは 12 週まで（AI の revise_goal の extend_weeks と同じ）
export const MAX_EXTEND_WEEKS = 12;

export type GoalRisk = {
  // maybe: 届かないかも / off: このままでは届かない
  level: "maybe" | "off";
  value: number;
  target: number;
  projected: number;
  daysLeft: number;
  // 届くのに要る、残りの 1 週あたりの数（切り上げ）
  needPerWeek: number;
  // いまのペース（数え始めから数えた最後の日まで、1 週あたり。小数 1 桁）
  nowPerWeek: number;
};

// 届かない見込みか。数えていない・仮の KGI・届いた・期限が来た（目標の振り返りが出る）・見込みがまだ出せないときは null
export function goalRisk(goal: Pick<Goal, "status" | "metric" | "target" | "endsOn" | "provisional">, p: GoalProgress | null): GoalRisk | null {
  if (!p || goal.status !== "active" || goal.metric === null || goal.metric === "posts" || goal.target === null || !goal.endsOn || goal.provisional) return null;
  if (!p.available || p.projected === null || p.countedDays < RISK_MIN_DAYS || p.target <= 0) return null;
  if (p.value >= p.target || p.daysLeft <= 0) return null;
  const ratio = p.projected / p.target;
  if (ratio >= 1) return null;
  const weeksLeft = p.daysLeft / 7;
  return {
    level: ratio < RISK_OFF_RATIO ? "off" : "maybe",
    value: p.value,
    target: p.target,
    projected: p.projected,
    daysLeft: p.daysLeft,
    needPerWeek: Math.ceil((p.target - p.value) / weeksLeft),
    nowPerWeek: Math.round((p.value / p.countedDays) * 7 * 10) / 10,
  };
}

export const RISK_TITLE: Record<GoalRisk["level"], string> = {
  off: "このままでは目標に届かない見込みです",
  maybe: "目標に届かないかもしれません",
};

// 数の単位（売上は formatMetric が「円」を付ける）
const UNIT: Partial<Record<GoalMetric, string>> = { posts: " 本", link_clicks: " 回", outcomes: " 件", followers: " 人", views: " 回", downloads: " 件", store_page_views: " 回" };

// 1 週あたりの数の書き方。1 以上は「週 2 件」、1 未満は整数で読める「2 週に 1 件ほど」（2026-11-21 PM の判断。「週 0.5 件」は読みにくい）。
// 0 は「週 0 件」。売上は「週 1,200 円」
export function perWeekText(metric: GoalMetric, v: number): string {
  const u = UNIT[metric] ?? "";
  if (metric !== "revenue" && v > 0 && v < 1) {
    const n = Math.round(1 / v);
    return n <= 1 ? `週 1${u}ほど` : `${n} 週に 1${u}ほど`;
  }
  return `週 ${formatMetric(metric, v)}${u}`;
}

// 「届くには週 3 件のペースが要ります。いまは 2 週に 1 件ほどです」（ja-copy-reviewer: 単位がないと何の数かわからない）
export function paceText(metric: GoalMetric, risk: GoalRisk): string {
  const now = perWeekText(metric, risk.nowPerWeek);
  // 数字で始まるとき（「2 週に 1 件ほど」）だけ、前に空白を入れる
  return `届くには${perWeekText(metric, risk.needPerWeek)}のペースが要ります。いまは${now.startsWith("週") ? "" : " "}${now}です`;
}

export type ReviseChoice =
  | { kind: "lower"; target: number }
  // reachable: いまのペースで、のばした期限までに届く見込みか（12 週のばしても届かなければ false）
  | { kind: "extend"; weeks: number; endsOn: string; reachable: boolean };

// 見直しの案（いまの見込みまで目標を下げる・いまのペースで届くまで期限をのばす）。どちらも作れなければ空。
// サーバーの操作は、送られた値ではなく、この関数で計算し直した値で書く
export function reviseChoices(goal: Pick<Goal, "endsOn">, risk: GoalRisk): ReviseChoice[] {
  const out: ReviseChoice[] = [];
  const lowered = Math.max(Math.round(risk.projected), Math.floor(risk.value) + 1);
  if (lowered < risk.target) out.push({ kind: "lower", target: lowered });
  if (goal.endsOn && risk.nowPerWeek > 0) {
    const weeksNeeded = (risk.target - risk.value) / risk.nowPerWeek;
    const extra = Math.ceil(weeksNeeded - risk.daysLeft / 7);
    const weeks = Math.min(MAX_EXTEND_WEEKS, Math.max(1, extra));
    out.push({ kind: "extend", weeks, endsOn: addDays(goal.endsOn, weeks * 7), reachable: extra <= MAX_EXTEND_WEEKS });
  }
  return out;
}

// 目標の文の中の数字を、新しい目標の値に置き換えた案（同じ数字がちょうど 1 か所のときだけ。ほかは文をそのまま返す。利用者が直せる）
export function restateTarget(statement: string, oldTarget: number, newTarget: number): string {
  const variants = [String(oldTarget), oldTarget.toLocaleString("ja-JP")];
  for (const v of [...new Set(variants)]) {
    const re = new RegExp(`(?<![\\d,.])${v.replace(/[.,]/g, (c) => `\\${c}`)}(?![\\d,.])`, "g");
    const hits = statement.match(re);
    if (hits && hits.length === 1) return statement.replace(re, v.includes(",") ? newTarget.toLocaleString("ja-JP") : String(newTarget));
  }
  return statement;
}
