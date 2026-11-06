"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { saveManualGoal } from "./manual";
import { goalInputSchema, kpiInputSchema, MAX_KPIS_PER_GOAL, type GoalInput, type KpiInput } from "./schema";
import { GoalError, settleGoal } from "./write";

// ロードマップで目標（KGI）・中間の目標・KPI を手で決める・直す（段階 ②。docs/design/goals-model.md の 5.）。
// 書くのは DB の関数だけ（状態・結果・区切りの日付はサーバーが決める）。利用者の権限のクライアントで書く

export type GoalFormState = { error?: string; ok?: boolean };

const uuid = z.uuid();

function num(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// 画面の選択肢: "outcomes:booking" は成果（予約）、"followers" はすべての SNS のフォロワーの増え方
function parseMetric(v: FormDataEntryValue | null): { metric: string; action: string | null } {
  const [metric = "", action = ""] = String(v ?? "").split(":");
  return { metric, action: action || null };
}

function done(projectId: string): GoalFormState {
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

function failed(e: unknown): GoalFormState {
  if (e instanceof GoalError) return { error: e.userMessage };
  console.error("goal form", e);
  return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
}

export async function saveGoalForm(projectId: string, _prev: GoalFormState, formData: FormData): Promise<GoalFormState> {
  if (!uuid.safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };

  // KPI（3 つまで。空の行は使わない）
  const kpis: KpiInput[] = [];
  const perWeek = formData.getAll("per_week");
  for (const [i, raw] of formData.getAll("kpi").entries()) {
    if (!raw) continue;
    const parsed = kpiInputSchema.safeParse({ ...parseMetric(raw), sns: null, per_week: num(perWeek[i] ?? null) });
    if (!parsed.success) return { error: `${i + 1} つ目の KPI の 1 週の目標を、0 より大きい数で入れてください。` };
    kpis.push(parsed.data);
  }
  if (kpis.length > MAX_KPIS_PER_GOAL) return { error: `KPI は ${MAX_KPIS_PER_GOAL} つまでにしてください。` };
  if (new Set(kpis.map((k) => `${k.metric}:${k.action ?? ""}`)).size !== kpis.length) return { error: "同じ数字の KPI が 2 つあります。" };

  const statement = String(formData.get("statement") ?? "").trim();
  // 中間の目標は milestone-<何か月目>（空欄は目標なし。始まった区切りの欄は送られない）
  const milestones: Record<number, number | null> = {};
  for (let seq = 1; seq <= 13; seq++) if (formData.has(`milestone-${seq}`)) milestones[seq] = num(formData.get(`milestone-${seq}`));
  if (Object.values(milestones).some((v) => v !== null && !(v > 0))) return { error: "中間の目標は、0 より大きい数で入れてください（空欄は目標なし）。" };

  let goal: GoalInput | null = null;
  if (statement) {
    const parsed = goalInputSchema.safeParse({ statement, ...parseMetric(formData.get("metric")), sns: null, target: num(formData.get("target")), weeks: num(formData.get("weeks")) ?? undefined, provisional: false });
    if (!parsed.success) return { error: "目標の文・数字の種類・目標の値を入れてください（目標の値は 0 より大きい数）。" };
    goal = parsed.data;
  }
  try {
    await saveManualGoal(await createClient(), projectId, { goal, milestones, kpis });
  } catch (e) {
    return failed(e);
  }
  return done(projectId);
}

// この目標を終える（AI なしで。結果を数えて閉じ、週の回数を引き継いだ「KGI まだ」の目標を始める）
export async function settleGoalAction(projectId: string, goalId: string): Promise<{ error?: string }> {
  if (!z.array(uuid).safeParse([projectId, goalId]).success) return { error: "入力の形式が正しくありません。" };
  try {
    await settleGoal(await createClient(), goalId);
  } catch (e) {
    return { error: failed(e).error };
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return {};
}
