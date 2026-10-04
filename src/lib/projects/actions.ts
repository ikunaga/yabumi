"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseProjectForm, toFieldErrors, type ProjectFieldErrors } from "./schema";

export type ProjectFormState = {
  error?: string;
  fieldErrors?: ProjectFieldErrors;
  values?: Record<string, string>;
};

const idSchema = z.uuid();

function echoValues(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of ["name", "description", "target_audience", "app_store_url", "play_store_url"]) {
    values[key] = String(formData.get(key) ?? "");
  }
  return values;
}

export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const parsed = parseProjectForm(formData);
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error), values: echoValues(formData) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").insert(parsed.data).select("id").single();
  if (error) {
    return { error: "プロジェクトを作成できませんでした。時間をおいてもう一度お試しください。", values: echoValues(formData) };
  }

  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}

export async function updateProject(
  id: string,
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  if (!idSchema.safeParse(id).success) return { error: "プロジェクトが見つかりません" };

  const parsed = parseProjectForm(formData);
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error), values: echoValues(formData) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").update(parsed.data).eq("id", id).select("id");
  if (error || data.length === 0) {
    return { error: "保存できませんでした。時間をおいてもう一度お試しください。", values: echoValues(formData) };
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}`);
}

export async function deleteProject(id: string) {
  if (!idSchema.safeParse(id).success) redirect("/projects");

  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error("プロジェクトを削除できませんでした");

  revalidatePath("/projects");
  redirect("/projects");
}
