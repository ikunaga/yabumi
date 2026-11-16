import { isSnsKey } from "@/lib/sns";
import type { AutoKind, AutoMaterials, AutoPlan, AutoRun, AutoRunReason, AutoRunStatus, AutoSchedule, AutoStopReason, AutoTargets } from "./types";

// DB の行を型にする（読み取り〈queries.ts〉とジョブ〈engine.ts〉で共通）

export type PlanRow = {
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

export type RunRow = { id: string; plan_id: string; due_at: string; generate_at: string; status: string; post_id: string | null; reason: string | null; reason_detail: string | null };

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

