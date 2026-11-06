import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { actionListSchema, goalInputSchema, kpiListSchema, milestoneCount, type ActionInput, type GoalInput, type KpiInput } from "./schema";

// 目標を書く（docs/design/goals-model.md の 2.4）。書くのは DB の関数だけで、利用者の権限のクライアント（auth.uid() が本人）を渡す。
// 状態・結果の値・区切りの日付は関数が決める。ここでは形を確かめてから渡すだけ（DB でも同じことを確かめる）

type Db = SupabaseClient<Database>;

export class GoalError extends Error {
  constructor(public userMessage: string) {
    super(userMessage);
  }
}

const INVALID = "目標の形が正しくありません。";

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new GoalError(INVALID);
  return r.data;
}

function rpcError(error: { code?: string } | null): never {
  if (error?.code === "42501") throw new GoalError("目標が見つかりません。画面を読み込み直してください。");
  if (error?.code === "22023" || error?.code === "23514") throw new GoalError(INVALID);
  throw error;
}

export type StartGoalInput = {
  // null は KGI まだ（週の回数とやることだけの期間）
  goal: GoalInput | null;
  // 4 週ごとの中間の目標（区切りの数まで。null は目標なし）
  milestones?: (number | null)[];
  // KPI（null・省略なら持たない）
  kpis?: KpiInput[] | null;
  // 行動の目標（null・省略なら、いまの目標のものを引き継ぐ）
  actions?: ActionInput[] | null;
};

// 新しい目標を始める。いまの目標は結果を数えて閉じる（達成・期限切れ・見直し）。新しい目標の id を返す
export async function startGoal(db: Db, projectId: string, input: StartGoalInput, source: "ai" | "manual"): Promise<string> {
  const goal = input.goal === null ? null : parse(goalInputSchema, input.goal);
  const kpis = input.kpis == null ? null : parse(kpiListSchema, input.kpis);
  const actions = input.actions == null ? null : parse(actionListSchema, input.actions);
  const count = milestoneCount(goal?.weeks ?? 4);
  const milestones = (input.milestones ?? []).slice(0, count).map((v) => (typeof v === "number" && v > 0 ? v : null));
  const { data, error } = await db.rpc("start_goal", {
    p_project_id: projectId,
    p_goal: goal as never,
    p_milestones: milestones as never,
    p_kpis: kpis as never,
    p_actions: actions as never,
    p_source: source,
  });
  if (error) rpcError(error);
  return data as string;
}

// いまの目標を見直す（文・目標の値・期限、まだ始まっていない区切りの目標 {seq: 値}）
export async function reviseGoal(db: Db, goalId: string, patch: { statement?: string; target?: number; endsOn?: string; milestones?: Record<number, number | null> }): Promise<void> {
  if (patch.statement !== undefined && (patch.statement.trim().length < 1 || patch.statement.length > 120)) throw new GoalError(INVALID);
  if (patch.target !== undefined && !(patch.target > 0 && patch.target <= 10_000_000)) throw new GoalError(INVALID);
  const { error } = await db.rpc("revise_goal", {
    p_goal_id: goalId,
    // 変えないものは null（PostgREST は省いた引数の関数を探せないので、すべて渡す）
    p_statement: (patch.statement?.trim() ?? null) as string,
    p_target: (patch.target ?? null) as number,
    p_ends_on: (patch.endsOn ?? null) as string,
    p_milestones: (patch.milestones ?? null) as never,
  });
  if (error) rpcError(error);
}

// KPI を入れ替える（1〜3 個。posts は入れない）
export async function setGoalKpis(db: Db, projectId: string, kpis: KpiInput[]): Promise<string> {
  const { data, error } = await db.rpc("set_goal_kpis", { p_project_id: projectId, p_role: "kpi", p_kpis: parse(kpiListSchema, kpis) as never });
  if (error) rpcError(error);
  return data as string;
}

// 行動の目標（SNS ごとの投稿の週の本数）を入れ替える。目標がなければ KGI まだの目標を作る（アカウント設計の週の回数）
export async function setGoalActions(db: Db, projectId: string, actions: ActionInput[]): Promise<string> {
  const { data, error } = await db.rpc("set_goal_kpis", { p_project_id: projectId, p_role: "action", p_kpis: parse(actionListSchema, actions) as never });
  if (error) rpcError(error);
  return data as string;
}

// 次の区切り（今週から 4 週）を始める。終わった区切りの結果は DB が数えて入れる
export async function startMilestone(db: Db, projectId: string, target: number | null): Promise<string> {
  if (target !== null && !(target > 0 && target <= 10_000_000)) throw new GoalError(INVALID);
  const { data, error } = await db.rpc("start_milestone", { p_project_id: projectId, p_target: target as number });
  if (error) rpcError(error);
  return data as string;
}

// 目標を終える（AI なしで）。結果を数えて閉じ、行動の目標を引き継いだ KGI まだの目標を始める
export async function settleGoal(db: Db, goalId: string): Promise<string> {
  const { data, error } = await db.rpc("settle_goal", { p_goal_id: goalId });
  if (error) rpcError(error);
  return data as string;
}
