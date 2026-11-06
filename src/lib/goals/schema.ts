import { z } from "zod";
import { MAX_WEEKLY_PER_SNS } from "@/lib/plan/schema";
import { OUTCOME_ACTIONS, type DesiredAction } from "@/lib/projects/product-types";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { WeeklyTargets } from "@/lib/coach/pace";

// 目標（KGI）・中間の目標・KPI と行動の目標の形（docs/design/goals-model.md）。画面とサーバーの両方から読む。
// DB の check と関数（20261106150000_goals）が正で、ここは画面と AI の案を確かめるための写し

// 数字の種類。posts は行動の目標（週の本数）だけで、新しい KGI と KPI には使わない（前の KGI を移したものだけ残る）
export const GOAL_METRICS = ["posts", "link_clicks", "downloads", "store_page_views", "revenue", "outcomes", "followers", "views"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
export const KGI_METRICS = GOAL_METRICS.filter((m) => m !== "posts") as Exclude<GoalMetric, "posts">[];
export type OutcomeAction = (typeof OUTCOME_ACTIONS)[number];

export const GOAL_STATUSES = ["active", "achieved", "expired", "replaced"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

// 1 区切り ＝ 4 週（2026-11-06 オーナーの決定 Q1）。KGI の基本は 12 週
export const MILESTONE_WEEKS = 4;
export const DEFAULT_GOAL_WEEKS = 12;
export const MIN_GOAL_WEEKS = 4;
export const MAX_GOAL_WEEKS = 52;
export const MAX_KPIS_PER_GOAL = 3;
export const MAX_GOAL_STATEMENT = 120;
export const MAX_GOAL_TARGET = 10_000_000;

// 自動で数える（yabumi のデータ）/ つなげば自動（ストア・SNS）/ 手で入れる
export type MetricCounting = "auto" | "connect" | "manual";
export const METRIC_COUNTING: Record<GoalMetric, MetricCounting> = {
  posts: "auto",
  link_clicks: "auto",
  downloads: "connect",
  store_page_views: "connect",
  revenue: "connect",
  followers: "connect",
  views: "connect",
  outcomes: "manual",
};

// 数字を指す 1 つの組（outcomes は action、followers・views・posts は SNS で絞れる）
export type MetricRef = { metric: GoalMetric; action: OutcomeAction | null; sns: SnsKey | null };

export type Goal = MetricRefOrNull & {
  id: string;
  projectId: string;
  statement: string | null;
  target: number | null;
  startsOn: string;
  endsOn: string | null;
  status: GoalStatus;
  resultValue: number | null;
  closedAt: string | null;
  provisional: boolean;
  source: "ai" | "manual";
};
// KGI まだの目標は metric が null
type MetricRefOrNull = { metric: GoalMetric | null; action: OutcomeAction | null; sns: SnsKey | null };

export type Milestone = {
  id: string;
  seq: number;
  startsOn: string;
  endsOn: string;
  target: number | null;
  resultValue: number | null;
  settledAt: string | null;
};

export type GoalKpi = MetricRef & { id: string; role: "kpi" | "action"; perWeek: number; position: number };

// 数えた結果（DB の goal_metric_total）。countedThrough は数えた最後の日。available が false なら取り込み元がない
export type MetricTotal = { value: number; countedThrough: string | null; available: boolean };

export function isGoalMetric(v: unknown): v is GoalMetric {
  return typeof v === "string" && (GOAL_METRICS as readonly string[]).includes(v);
}

export function isOutcomeAction(v: unknown): v is OutcomeAction {
  return typeof v === "string" && (OUTCOME_ACTIONS as readonly string[]).includes(v);
}

// 「見た人にしてほしいこと」（アカウント設計の goal.goalType）→ KGI の数字の既定（AI の案と、手で決めるときの初期値）
export function kgiMetricFor(goalType: DesiredAction | null): MetricRef {
  switch (goalType) {
    case "download":
      return { metric: "downloads", action: null, sns: null };
    case "purchase":
    case "signup":
    case "booking":
    case "inquiry":
    case "visit":
      return { metric: "outcomes", action: goalType, sns: null };
    case "follow":
      return { metric: "followers", action: null, sns: null };
    case "awareness":
      return { metric: "views", action: null, sns: null };
    default:
      return { metric: "link_clicks", action: null, sns: null };
  }
}

// ===== 書くときの形（AI の案・手の入力。start_goal などの関数に渡す） =====
const metricRefShape = {
  action: z.enum(OUTCOME_ACTIONS).nullable().default(null),
  sns: z.enum(SNS_KEYS).nullable().default(null),
};

function refOk(r: { metric: GoalMetric; action: OutcomeAction | null; sns: SnsKey | null }): boolean {
  if ((r.metric === "outcomes") !== (r.action !== null)) return false;
  if (r.sns !== null && !["posts", "followers", "views"].includes(r.metric)) return false;
  return true;
}

export const goalInputSchema = z
  .object({
    statement: z.string().trim().min(1).max(MAX_GOAL_STATEMENT),
    metric: z.enum(KGI_METRICS as [Exclude<GoalMetric, "posts">, ...Exclude<GoalMetric, "posts">[]]),
    ...metricRefShape,
    target: z.number().positive().max(MAX_GOAL_TARGET),
    weeks: z.number().int().min(MIN_GOAL_WEEKS).max(MAX_GOAL_WEEKS).default(DEFAULT_GOAL_WEEKS),
    provisional: z.boolean().default(false),
  })
  .refine(refOk, "数字の種類と、成果・SNS の組み合わせが合いません");
export type GoalInput = z.infer<typeof goalInputSchema>;

export const kpiInputSchema = z
  .object({
    metric: z.enum(KGI_METRICS as [Exclude<GoalMetric, "posts">, ...Exclude<GoalMetric, "posts">[]]),
    ...metricRefShape,
    per_week: z.number().positive().max(1_000_000),
  })
  .refine(refOk, "数字の種類と、成果・SNS の組み合わせが合いません");
export type KpiInput = z.infer<typeof kpiInputSchema>;
export const kpiListSchema = z.array(kpiInputSchema).max(MAX_KPIS_PER_GOAL);

// 行動の目標: SNS ごとの投稿の週の本数（null はすべての SNS）
export const actionInputSchema = z.object({
  sns: z.enum(SNS_KEYS).nullable().default(null),
  per_week: z.number().int().min(1).max(MAX_WEEKLY_PER_SNS),
});
export type ActionInput = z.infer<typeof actionInputSchema>;
export const actionListSchema = z.array(actionInputSchema).max(SNS_KEYS.length + 1);

// 中間の目標（4 週ごと。null は目標なし）。KGI の週の数から区切りの数が決まる
export function milestoneCount(weeks: number): number {
  return Math.max(1, Math.ceil(weeks / MILESTONE_WEEKS));
}

// ===== 読むときの変換 =====

// 行動の目標 → 伴走の週の回数（SNS ごと。すべての SNS の行は伴走では使わない）
export function weeklyTargetsOf(kpis: GoalKpi[]): WeeklyTargets {
  const out: WeeklyTargets = {};
  for (const k of kpis) if (k.role === "action" && k.sns) out[k.sns] = k.perWeek;
  return out;
}

// 週の回数 → 行動の目標の入力（アカウント設計の画面で保存するとき）
export function actionsFromWeekly(weekly: WeeklyTargets): ActionInput[] {
  return SNS_KEYS.filter((s) => (weekly[s] ?? 0) >= 1).map((s) => ({ sns: s, per_week: Math.min(MAX_WEEKLY_PER_SNS, Math.round(weekly[s]!)) }));
}

// 期限が来た・目標に届いた（概要の帯で区切りを知らせる）
export function goalNeedsReview(goal: Goal, progress: MetricTotal | null, today: string): "reached" | "ended" | null {
  if (goal.status !== "active" || goal.metric === null || goal.target === null) return null;
  if (progress?.available && progress.value >= goal.target) return "reached";
  if (goal.endsOn !== null && goal.endsOn < today) return "ended";
  return null;
}

// 前の作りから移した、投稿の本数の KGI（「成果の目標に変えましょう」と知らせる。Q2）
export function isLegacyActionGoal(goal: Goal): boolean {
  return goal.status === "active" && goal.metric === "posts";
}

// いまの区切り（今日を含むもの。なければ null）
export function currentMilestone(milestones: Milestone[], today: string): Milestone | null {
  return milestones.find((m) => m.startsOn <= today && today <= m.endsOn) ?? null;
}
