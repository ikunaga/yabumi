"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { itemSchema, kgiSchema, kpiTargetsSchema } from "./schema";
import { addItems, RoadmapError, saveGoal } from "./write";

// ロードマップを手で直す（docs/architecture.md の 4.23）。RLS で本人のものだけ書ける

export type RoadmapFormState = { error?: string; ok?: boolean };

const projectIdSchema = z.uuid();

function done(projectId: string): RoadmapFormState {
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

function num(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// 目標（KGI）と KPI の週の目標
export async function saveGoalForm(projectId: string, _prev: RoadmapFormState, formData: FormData): Promise<RoadmapFormState> {
  if (!projectIdSchema.safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  const statement = String(formData.get("statement") ?? "").trim();
  let kgi = null;
  if (statement) {
    const parsed = kgiSchema.safeParse({
      statement,
      kpi: formData.get("kgi_kpi"),
      target: num(formData.get("kgi_target")),
      deadline: formData.get("kgi_deadline"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "目標の形が正しくありません。" };
    kgi = parsed.data;
  }
  const kpis = formData.getAll("kpi").map(String);
  const perWeek = formData.getAll("per_week").map((v) => num(v));
  const targets = kpis.map((kpi, i) => ({ kpi, per_week: perWeek[i] })).filter((t) => t.kpi && t.per_week !== null);
  const parsedTargets = kpiTargetsSchema.safeParse(targets);
  if (!parsedTargets.success) return { error: parsedTargets.error.issues[0]?.message ?? "週の目標の形が正しくありません。" };
  try {
    await saveGoal(await createClient(), projectId, { kgi, kpiTargets: parsedTargets.data }, "manual");
  } catch (e) {
    return { error: e instanceof RoadmapError ? e.userMessage : "保存できませんでした。" };
  }
  return done(projectId);
}

// やることを 1 つ足す
export async function addItemForm(projectId: string, _prev: RoadmapFormState, formData: FormData): Promise<RoadmapFormState> {
  if (!projectIdSchema.safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  const kpi = String(formData.get("kpi") ?? "");
  const parsed = itemSchema.safeParse({
    title: formData.get("title"),
    detail: formData.get("detail") ?? "",
    week_start: formData.get("week_start"),
    kpi: kpi || null,
    target: kpi ? num(formData.get("target")) : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "やることの形が正しくありません。" };
  try {
    await addItems(await createClient(), projectId, [parsed.data], "manual");
  } catch (e) {
    return { error: e instanceof RoadmapError ? e.userMessage : "保存できませんでした。" };
  }
  return done(projectId);
}

// 済み・やらない・まだ を切り替える
export async function setItemStatus(projectId: string, itemId: string, status: "todo" | "done" | "skipped"): Promise<{ error?: string }> {
  if (!z.array(z.uuid()).safeParse([projectId, itemId]).success || !["todo", "done", "skipped"].includes(status)) return { error: "入力の形式が正しくありません。" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roadmap_items")
    .update({ status, done_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id");
  if (error || !data?.length) return { error: "更新できませんでした。画面を読み込み直してください。" };
  done(projectId);
  return {};
}

// やることを消す
export async function deleteItem(projectId: string, itemId: string): Promise<{ error?: string }> {
  if (!z.array(z.uuid()).safeParse([projectId, itemId]).success) return { error: "入力の形式が正しくありません。" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("roadmap_items").delete().eq("id", itemId).eq("project_id", projectId).select("id");
  if (error || !data?.length) return { error: "消せませんでした。画面を読み込み直してください。" };
  done(projectId);
  return {};
}
