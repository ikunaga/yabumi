"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSectionKey, parseSectionForm } from "./schema";

export type SectionFormState = { error?: string; savedAt?: number };

// 1 つのセクションを保存する（途中まででも保存できる）
export async function saveSection(projectId: string, section: string, _prev: SectionFormState, formData: FormData): Promise<SectionFormState> {
  if (!z.uuid().safeParse(projectId).success || !isSectionKey(section)) return { error: "入力の形式が正しくありません。" };
  const parsed = parseSectionForm(section, formData);
  if (!parsed.success) {
    // 文言はスキーマ側で日本語にしてある
    return { error: parsed.error.issues[0]?.message ?? "入力の形式が正しくありません。" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_account_plan_section", {
    p_project_id: projectId,
    p_section: section,
    p_value: parsed.data,
  });
  if (error) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };

  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/projects");
  return { savedAt: Date.now() };
}

// 「あとで設計する」: 設計を飛ばして次の段階（SNS をつなぐ）へ進む
export async function skipPlan(projectId: string) {
  if (!z.uuid().safeParse(projectId).success) redirect("/projects");
  const supabase = await createClient();
  const { error } = await supabase
    .from("account_plans")
    .upsert({ project_id: projectId, skipped_at: new Date().toISOString() }, { onConflict: "project_id" });
  if (error) throw new Error("保存できませんでした");
  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
