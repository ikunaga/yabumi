"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { addDays, isYmd } from "@/lib/time";
import { itemSchema, parseKpiChoice } from "./schema";
import { addItems, RoadmapError } from "./write";

// ロードマップのやることを手で直す（docs/architecture.md の 4.23）。RLS で本人のものだけ書ける。目標（KGI）・KPI は lib/goals/actions.ts

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

// やることを 1 つ足す
export async function addItemForm(projectId: string, _prev: RoadmapFormState, formData: FormData): Promise<RoadmapFormState> {
  if (!projectIdSchema.safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  const { kpi, sns } = parseKpiChoice(formData.get("kpi"));
  const parsed = itemSchema.safeParse({
    sns,
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

// 予定日を決める・外す（その週の中の日だけ。DB の check でも守る）
export async function setItemPlannedOn(projectId: string, itemId: string, plannedOn: string | null): Promise<{ error?: string }> {
  if (!z.array(z.uuid()).safeParse([projectId, itemId]).success || (plannedOn !== null && !isYmd(plannedOn))) return { error: "入力の形式が正しくありません。" };
  const supabase = await createClient();
  const { data: item } = await supabase.from("roadmap_items").select("week_start").eq("id", itemId).eq("project_id", projectId).maybeSingle();
  if (!item) return { error: "やることが見つかりません。画面を読み込み直してください。" };
  if (plannedOn !== null && (plannedOn < item.week_start || plannedOn > addDays(item.week_start, 6))) return { error: "予定日は、そのやることの週の中の日にしてください。" };
  const { data, error } = await supabase.from("roadmap_items").update({ planned_on: plannedOn }).eq("id", itemId).eq("project_id", projectId).select("id");
  if (error || !data?.length) return { error: "更新できませんでした。画面を読み込み直してください。" };
  done(projectId);
  return {};
}
