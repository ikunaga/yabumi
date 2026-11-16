import "server-only";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";
import { dueTimes } from "./schedule";
import type {
  AutoKind,
  AutoMaterials,
  AutoPlan,
  AutoReviewItem,
  AutoRun,
  AutoRunReason,
  AutoRunStatus,
  AutoSchedule,
  AutoStopReason,
  AutoTargetPreview,
  AutoTargets,
  ProjectEvent,
  UpcomingAutoRun,
} from "./types";

// 自動の投稿の読み取り（利用者の権限のクライアントで。RLS で本人のものだけ）。画面とカレンダー・概要から呼ぶ

type Db = Awaited<ReturnType<typeof createClient>>;

const PLAN_COLUMNS =
  "id, project_id, name, kind, materials, targets, x_link, schedule, tone, lead_hours, first_review, status, stop_reason, fail_streak, consented_at, created_at, updated_at";
const RUN_COLUMNS = "id, plan_id, due_at, generate_at, status, post_id, reason, reason_detail";

type PlanRow = {
  id: string;
  project_id: string;
  name: string;
  kind: string;
  materials: unknown;
  targets: unknown;
  x_link: string;
  schedule: unknown;
  tone: string;
  lead_hours: number;
  first_review: boolean;
  status: string;
  stop_reason: string | null;
  fail_streak: number;
  consented_at: string;
  created_at: string;
  updated_at: string;
};

export function toPlan(r: PlanRow): AutoPlan {
  const targets: AutoTargets = {};
  for (const [k, v] of Object.entries((r.targets ?? {}) as Record<string, unknown>)) {
    if (isSnsKey(k) && (v === "auto" || v === "review" || v === "by_hand")) targets[k] = v;
  }
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    kind: r.kind as AutoKind,
    materials: (r.materials ?? {}) as AutoMaterials,
    targets,
    xLink: r.x_link === "always" ? "always" : "never",
    schedule: r.schedule as AutoSchedule,
    tone: r.tone,
    leadHours: r.lead_hours,
    firstReview: r.first_review,
    status: r.status as AutoPlan["status"],
    stopReason: r.stop_reason as AutoStopReason | null,
    failStreak: r.fail_streak,
    consentedAt: r.consented_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type RunRow = { id: string; plan_id: string; due_at: string; generate_at: string; status: string; post_id: string | null; reason: string | null; reason_detail: string | null };

export function toRun(r: RunRow): AutoRun {
  return {
    id: r.id,
    planId: r.plan_id,
    dueAt: r.due_at,
    generateAt: r.generate_at,
    status: r.status as AutoRunStatus,
    postId: r.post_id,
    reason: r.reason as AutoRunReason | null,
    reasonDetail: r.reason_detail,
  };
}

async function db(): Promise<Db> {
  return createClient();
}

// プロジェクトの自動の回し方（作った順）
export async function listAutoPlans(projectId: string): Promise<AutoPlan[]> {
  const { data, error } = await (await db()).from("auto_plans").select(PLAN_COLUMNS).eq("project_id", projectId).order("created_at");
  if (error) throw new Error(`auto_plans: ${error.message}`);
  return (data as PlanRow[]).map(toPlan);
}

export async function getAutoPlan(planId: string): Promise<AutoPlan | null> {
  const { data, error } = await (await db()).from("auto_plans").select(PLAN_COLUMNS).eq("id", planId).maybeSingle();
  if (error) throw new Error(`auto_plans: ${error.message}`);
  return data ? toPlan(data as PlanRow) : null;
}

// 回し方の回（新しい順。結果を見る画面）
export async function listAutoRuns(planId: string, limit = 50): Promise<AutoRun[]> {
  const { data, error } = await (await db())
    .from("auto_runs")
    .select(RUN_COLUMNS)
    .eq("plan_id", planId)
    .order("due_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) throw new Error(`auto_runs: ${error.message}`);
  return (data as RunRow[]).map(toRun);
}

// これからの自動の回（カレンダー・概要）。from〜until の間の、動いている回し方の回。
// ジョブがまだ作っていない回（14 日より先など）は規則から出す（postId は null、status は waiting）。止めた・飛ばした回は出さない
export async function listUpcomingAutoRuns(projectId: string, from: Date, until: Date): Promise<UpcomingAutoRun[]> {
  const client = await db();
  const [plans, runs] = await Promise.all([
    client.from("auto_plans").select(PLAN_COLUMNS).eq("project_id", projectId).eq("status", "active"),
    client
      .from("auto_runs")
      .select(RUN_COLUMNS)
      .eq("project_id", projectId)
      .gt("due_at", from.toISOString())
      .lte("due_at", until.toISOString()),
  ]);
  if (plans.error) throw new Error(`auto_plans: ${plans.error.message}`);
  if (runs.error) throw new Error(`auto_runs: ${runs.error.message}`);
  const known = new Map((runs.data as RunRow[]).map((r) => [`${r.plan_id}|${new Date(r.due_at).getTime()}`, toRun(r)]));
  const out: UpcomingAutoRun[] = [];
  for (const plan of (plans.data as PlanRow[]).map(toPlan)) {
    const sns = Object.keys(plan.targets) as SnsKey[];
    for (const at of dueTimes(plan.schedule, from, until)) {
      const run = known.get(`${plan.id}|${at.getTime()}`);
      if (run && ["canceled", "skipped"].includes(run.status)) continue;
      out.push({ runId: run?.id ?? "", planId: plan.id, planName: plan.name, dueAt: at.toISOString(), status: run?.status ?? "waiting", postId: run?.postId ?? null, sns });
    }
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

type PreviewRow = { target_id: string; sns: string; status: string; title: string | null; body: string; fingerprint: string; approved_at: string | null };

export async function loadTargetPreviews(client: Db, postId: string): Promise<AutoTargetPreview[]> {
  const { data, error } = await client.rpc("auto_target_previews", { p_post_id: postId });
  if (error) throw new Error(`auto_target_previews: ${error.message}`);
  return ((data ?? []) as PreviewRow[])
    .filter((r) => isSnsKey(r.sns))
    .map((r) => ({ targetId: r.target_id, sns: r.sns as SnsKey, status: r.status, title: r.title, body: r.body, fingerprint: r.fingerprint, approvedAt: r.approved_at }));
}

// 確かめ待ち（送る時刻の前のもの）。最初の回の確かめ（A3）と、確かめて送る SNS の承認待ち
export async function listAutoReviewItems(projectId: string): Promise<AutoReviewItem[]> {
  const client = await db();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("auto_runs")
    .select(`${RUN_COLUMNS}, auto_plans(name)`)
    .eq("project_id", projectId)
    .in("status", ["review", "scheduled"])
    .gt("due_at", now)
    .not("post_id", "is", null)
    .order("due_at");
  if (error) throw new Error(`auto_runs: ${error.message}`);
  const items: AutoReviewItem[] = [];
  for (const r of data as (RunRow & { auto_plans: { name: string } | null })[]) {
    const targets = await loadTargetPreviews(client, r.post_id!);
    const waiting = targets.some((t) => t.status === "awaiting_approval");
    if (r.status === "scheduled" && !waiting) continue;
    items.push({
      kind: r.status === "review" ? "first_review" : "approval",
      runId: r.id,
      planId: r.plan_id,
      planName: r.auto_plans?.name ?? "",
      postId: r.post_id!,
      dueAt: r.due_at,
      targets,
    });
  }
  return items;
}

// 確かめ待ちの数（一覧の上と概要の帯）
export async function countAutoReviewItems(projectId: string): Promise<number> {
  return (await listAutoReviewItems(projectId)).length;
}

// お知らせ・季節の予定（日付の順）
export async function listProjectEvents(projectId: string): Promise<ProjectEvent[]> {
  const { data, error } = await (await db()).from("project_events").select("id, on_date, body").eq("project_id", projectId).order("on_date").order("created_at");
  if (error) throw new Error(`project_events: ${error.message}`);
  return data.map((r) => ({ id: r.id, onDate: r.on_date, body: r.body }));
}
