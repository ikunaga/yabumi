import type { SupabaseClient } from "@supabase/supabase-js";
import { isSnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";
import { currentMilestone, isGoalMetric, isOutcomeAction, type Goal, type GoalKpi, type GoalStatus, type MetricRef, type MetricTotal, type Milestone } from "./schema";

// 目標の読み込み（docs/design/goals-model.md）。クライアントは呼ぶ側が渡す（画面と相談は利用者の権限で RLS、伴走のジョブはサーバーの権限）

type Db = SupabaseClient<Database>;

const GOAL_COLUMNS = "id, project_id, statement, metric, action, sns, target, starts_on, ends_on, status, result_value, closed_at, provisional, source";

type GoalRow = Database["public"]["Tables"]["goals"]["Row"];
type MilestoneRow = Database["public"]["Tables"]["goal_milestones"]["Row"];
type KpiRow = Database["public"]["Tables"]["goal_kpis"]["Row"];

export function toGoal(r: Pick<GoalRow, "id" | "project_id" | "statement" | "metric" | "action" | "sns" | "target" | "starts_on" | "ends_on" | "status" | "result_value" | "closed_at" | "provisional" | "source">): Goal {
  return {
    id: r.id,
    projectId: r.project_id,
    statement: r.statement,
    metric: isGoalMetric(r.metric) ? r.metric : null,
    action: isOutcomeAction(r.action) ? r.action : null,
    sns: isSnsKey(r.sns) ? r.sns : null,
    target: r.target === null ? null : Number(r.target),
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: r.status as GoalStatus,
    resultValue: r.result_value === null ? null : Number(r.result_value),
    closedAt: r.closed_at,
    provisional: r.provisional,
    source: r.source === "ai" ? "ai" : "manual",
  };
}

function toMilestone(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    seq: r.seq,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    target: r.target === null ? null : Number(r.target),
    resultValue: r.result_value === null ? null : Number(r.result_value),
    settledAt: r.settled_at,
  };
}

function toKpi(r: KpiRow): GoalKpi | null {
  if (!isGoalMetric(r.metric) || (r.role !== "kpi" && r.role !== "action")) return null;
  return {
    id: r.id,
    role: r.role,
    metric: r.metric,
    action: isOutcomeAction(r.action) ? r.action : null,
    sns: isSnsKey(r.sns) ? r.sns : null,
    perWeek: Number(r.per_week),
    position: r.position,
  };
}

// 数える（DB の goal_metric_total。今日より後は数えない）
export async function metricTotal(db: Db, projectId: string, ref: MetricRef, from: string, to: string): Promise<MetricTotal> {
  const { data, error } = await db
    .rpc("goal_metric_total", { p_project_id: projectId, p_metric: ref.metric, p_action: ref.action as string, p_sns: ref.sns as never, p_from: from, p_to: to })
    .single();
  if (error) throw error;
  const row = data as { value: number | string; counted_through: string | null; available: boolean };
  return { value: Number(row.value), countedThrough: row.counted_through, available: row.available };
}

export type GoalProgress = MetricTotal & {
  target: number;
  ratio: number;
  // 期限までの日数（今日を含まない。過ぎていれば 0）
  daysLeft: number;
  // このままのペース（数え始めから数えた最後の日までの 1 日あたり）で期限まで続けた見込み。7 日分たまるまで null
  projected: number | null;
};

export function progressOf(goal: Goal, total: MetricTotal, today: string): GoalProgress | null {
  if (goal.metric === null || goal.target === null || goal.endsOn === null) return null;
  const day = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
  const daysLeft = Math.max(0, day(goal.endsOn) - day(today));
  const counted = total.countedThrough ? day(total.countedThrough) - day(goal.startsOn) + 1 : 0;
  const span = day(goal.endsOn) - day(goal.startsOn) + 1;
  // followers・revenue は累計ではない（増えた人数・直近 28 日）ので、ペースの見込みは出さない
  const paced = goal.metric !== "revenue";
  const projected = paced && total.available && counted >= 7 ? Math.round((total.value / counted) * span) : null;
  return { ...total, target: goal.target, ratio: goal.target > 0 ? total.value / goal.target : 0, daysLeft, projected };
}

export type ActiveGoalView = {
  goal: Goal;
  milestones: Milestone[];
  current: Milestone | null;
  kpis: GoalKpi[];
  actions: GoalKpi[];
  // KGI の進み具合（KGI まだなら null）。いまの区切りの進み具合
  progress: GoalProgress | null;
  currentProgress: MetricTotal | null;
};

export type GoalsView = {
  today: string;
  active: ActiveGoalView | null;
  // これまでの目標（新しい順）
  past: Goal[];
};

// プロジェクトの目標をまとめて読む（いまの目標と、その区切り・KPI・進み具合、これまでの目標）
export async function loadGoals(db: Db, projectId: string, now: Date = new Date()): Promise<GoalsView> {
  const today = toYmd(now);
  const { data, error } = await db.from("goals").select(GOAL_COLUMNS).eq("project_id", projectId).order("starts_on", { ascending: false }).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  const goals = (data ?? []).map(toGoal);
  const activeGoal = goals.find((g) => g.status === "active") ?? null;
  const past = goals.filter((g) => g.status !== "active");
  if (!activeGoal) return { today, active: null, past };

  const [{ data: ms, error: msErr }, { data: ks, error: ksErr }] = await Promise.all([
    db.from("goal_milestones").select("*").eq("goal_id", activeGoal.id).order("seq"),
    db.from("goal_kpis").select("*").eq("goal_id", activeGoal.id).order("role").order("position"),
  ]);
  if (msErr) throw msErr;
  if (ksErr) throw ksErr;
  const milestones = (ms ?? []).map(toMilestone);
  const allKpis = (ks ?? []).map(toKpi).filter((k): k is GoalKpi => k !== null);
  const current = currentMilestone(milestones, today);
  let progress: GoalProgress | null = null;
  let currentProgress: MetricTotal | null = null;
  if (activeGoal.metric !== null && activeGoal.endsOn !== null) {
    const ref: MetricRef = { metric: activeGoal.metric, action: activeGoal.action, sns: activeGoal.sns };
    const [total, cur] = await Promise.all([
      metricTotal(db, projectId, ref, activeGoal.startsOn, activeGoal.endsOn),
      current ? metricTotal(db, projectId, ref, current.startsOn, current.endsOn) : Promise.resolve(null),
    ]);
    progress = progressOf(activeGoal, total, today);
    currentProgress = cur;
  }
  return {
    today,
    active: {
      goal: activeGoal,
      milestones,
      current,
      kpis: allKpis.filter((k) => k.role === "kpi"),
      actions: allKpis.filter((k) => k.role === "action"),
      progress,
      currentProgress,
    },
    past,
  };
}

// 伴走のジョブ（サーバーの権限）: 行動の目標のある active な目標を、プロジェクトごとに（いまの区切りの始まりと一緒に）
// cycles: 今日を含むか昨日で終わった区切り（月曜の振り返りのメールで「先週で 1 か月が終わった」を見る）
export type ActiveActions = { projectId: string; goalId: string; actions: GoalKpi[]; cycleStartedOn: string | null; cycles: { startsOn: string; endsOn: string }[] };

export async function loadActiveActions(admin: Db, projectIds: string[], now: Date = new Date()): Promise<ActiveActions[]> {
  if (projectIds.length === 0) return [];
  const today = toYmd(now);
  const { data: goals, error } = await admin.from("goals").select("id, project_id").in("project_id", projectIds).eq("status", "active");
  if (error) throw error;
  const ids = (goals ?? []).map((g) => g.id);
  if (ids.length === 0) return [];
  const [{ data: ks, error: kErr }, { data: ms, error: mErr }] = await Promise.all([
    admin.from("goal_kpis").select("*").in("goal_id", ids).eq("role", "action"),
    admin.from("goal_milestones").select("*").in("goal_id", ids).lte("starts_on", today).gte("ends_on", addDays(today, -1)),
  ]);
  if (kErr) throw kErr;
  if (mErr) throw mErr;
  return (goals ?? []).map((g) => {
    const cycles = (ms ?? []).filter((m) => m.goal_id === g.id).sort((a, b) => b.starts_on.localeCompare(a.starts_on));
    return {
      projectId: g.project_id,
      goalId: g.id,
      actions: (ks ?? []).filter((k) => k.goal_id === g.id).map(toKpi).filter((k): k is GoalKpi => k !== null),
      cycleStartedOn: cycles[0]?.starts_on ?? null,
      cycles: cycles.map((m) => ({ startsOn: m.starts_on, endsOn: m.ends_on })),
    };
  });
}
