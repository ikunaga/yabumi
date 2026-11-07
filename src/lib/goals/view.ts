import { clickLabel, isKpiKey, KPIS, kpiAllowed, type KpiKey } from "@/lib/metrics/kpis";
import { SNS, type SnsKey } from "@/lib/sns";
import { addDays } from "@/lib/time";
import { OUTCOME_ACTIONS } from "@/lib/projects/product-types";
import { KGI_METRICS, type Goal, type GoalKpi, type GoalMetric, type GoalStatus, type MetricRef, type OutcomeAction } from "./schema";

// 目標を画面に出すときの名前と数字の書き方（段階 ②。docs/design/goals-model.md の 5.）。数は DB の goal_metric_total が数えたものだけを使う

export const OUTCOME_LABEL: Record<OutcomeAction, string> = { purchase: "買ってもらった", signup: "申し込み・会員登録", booking: "予約", inquiry: "問い合わせ", visit: "来店" };

export const GOAL_STATUS_LABEL: Record<Exclude<GoalStatus, "active">, string> = { achieved: "達成", expired: "期限切れ", replaced: "見直し" };

// 数字の名前（「成果（予約）」「投稿した回数（X）」「フォロワーの増え方（Instagram）」）
export function metricLabel(ref: Pick<MetricRef, "metric" | "action" | "sns">, productType?: string | null): string {
  const sns = ref.sns ? SNS[ref.sns].label : null;
  switch (ref.metric) {
    case "outcomes":
      return ref.action ? `成果（${OUTCOME_LABEL[ref.action]}）` : KPIS.outcomes.label;
    case "link_clicks":
      return clickLabel(productType);
    case "posts":
      return `${KPIS.posts.label}（${sns ?? "すべての SNS"}）`;
    default:
      return sns ? `${KPIS[ref.metric].label}（${sns}）` : KPIS[ref.metric].label;
  }
}

export function formatMetric(metric: GoalMetric, value: number): string {
  return metric === "revenue" ? `${Math.round(value).toLocaleString("ja-JP")} 円` : (Math.round(value * 10) / 10).toLocaleString("ja-JP");
}

// 数えていない数字の案内（数字の代わりに出す。正しくない数字を見せない）
export function notCountedText(metric: GoalMetric, productType?: string | null): string {
  if (metric !== "outcomes" && metric !== "posts" && !kpiAllowed(metric, productType)) return "宣伝するものが「アプリ」のときだけ数えます";
  if (metric === "outcomes") return "分析の画面で成果を記録すると数えます";
  return KPIS[metric].howToGet ?? "数字の取り込みを作ったら数えます";
}

// 「11/4」
export function md(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

// 期間「11/2〜1/25」
export function spanText(from: string, to: string | null): string {
  return to ? `${md(from)}〜${md(to)}` : `${md(from)}〜`;
}

// 区切りの名前（1 区切り ＝ 4 週。オーナーの決定 Q1 で「月」と呼ぶ）
export function milestoneName(seq: number): string {
  return `${seq} か月目`;
}

// 概要の帯で、目標の振り返り（goal_review）を出すか。期限が来た・届いた（goalNeedsReview）とき。
// 届いて「期限まで続ける」を選んだあと（keptReached）は、期限が来るまで出さない
export function goalReviewOf(need: "reached" | "ended" | null, keptReached: boolean): "reached" | "ended" | null {
  if (need === "reached" && keptReached) return null;
  return need;
}

// 区切りの振り返り（cycle_ended）を、目標の振り返りにまとめるか。目標の期限が、終わった区切りの最後の日から 7 日以内なら、
// 目標の振り返りの中で次の 1 か月も決めるので、区切りの帯は出さない（設計の 5.）
export function cycleMergedIntoGoal(goal: Pick<Goal, "endsOn" | "metric"> | null, cycleEndsOn: string | null): boolean {
  if (!goal || goal.metric === null || !goal.endsOn || !cycleEndsOn) return false;
  return goal.endsOn <= addDays(cycleEndsOn, 7);
}

// 画面の選択肢の値（"outcomes:booking" は成果（予約））
export function metricChoiceValue(ref: Pick<MetricRef, "metric" | "action">): string {
  return ref.metric === "outcomes" && ref.action ? `outcomes:${ref.action}` : ref.metric;
}

// KGI と KPI に選べる数字（投稿の本数は行動の目標なので入れない）。アプリでなければストアの数字は出さない（いま選んでいるものは残す）
export function metricChoices(productType: string | null | undefined, current: string[] = []): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const m of KGI_METRICS) {
    if (m === "outcomes") {
      for (const a of OUTCOME_ACTIONS) out.push({ value: `outcomes:${a}`, label: metricLabel({ metric: m, action: a, sns: null }, productType) });
    } else if (m === "link_clicks" || m === "followers" || m === "views" || kpiAllowed(m, productType) || current.includes(m)) {
      out.push({ value: m, label: metricLabel({ metric: m, action: null, sns: null }, productType) + (kpiAllowed(m, productType) ? "" : "（アプリのときだけ数えます）") });
    }
  }
  return out;
}

// 分析・概要の数字のカードに出す数字: いまの目標の KPI（goal_kpis の kpi）。なければ前の作りの選び方（アカウント設計の数字・目的からのおすすめ）
export function kpiCardKeys(kpis: Pick<GoalKpi, "metric">[], productType: string | null | undefined, fallback: KpiKey[]): KpiKey[] {
  const keys = [...new Set(kpis.map((k) => k.metric))].filter((m): m is KpiKey => isKpiKey(m) && kpiAllowed(m, productType));
  return keys.length ? keys : fallback;
}

// アカウント設計の「週の回数」の欄に出す値: いまの目標の行動の目標（goals が正。JSON の first_month には週の回数を持たない。段階 ④）
export function withGoalWeekly<T extends { weekly: Partial<Record<SnsKey, number>> }>(fm: T, actions: Pick<GoalKpi, "role" | "sns" | "perWeek">[]): T {
  const weekly: Partial<Record<SnsKey, number>> = {};
  for (const a of actions) if (a.role === "action" && a.sns) weekly[a.sns] = a.perWeek;
  return { ...fm, weekly };
}
