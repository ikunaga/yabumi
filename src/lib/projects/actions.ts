"use server";

import { revalidatePath } from "next/cache";
import { isProductType, type ProductType } from "./product-types";
import { redirect } from "next/navigation";
import { z } from "zod";
import { defaultLinkDomainDeps, drainLinkDomainRemovals } from "@/lib/links/domains";
import { createAdminClient } from "@/lib/supabase/admin";
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
  revalidatePath(`/projects/${id}`, "layout");
  // 設定の画面に戻り、保存したことを知らせる
  redirect(`/projects/${id}/edit?done=saved`);
}

// 失敗したときは { error } を返し、編集の画面に出す
export async function deleteProject(id: string): Promise<{ error?: string }> {
  if (!idSchema.safeParse(id).success) redirect("/projects");

  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return { error: "プロジェクトを削除できませんでした。時間をおいて、もう一度お試しください。" };
  // 短縮リンクの利用者のドメインがあれば、Vercel から外す（DB のトリガーが外す列に積んでいる。外せなければ次の機会にやり直す。D28）
  await drainLinkDomainRemovals(createAdminClient(), defaultLinkDomainDeps()).catch((e) =>
    console.error("[deleteProject] 利用者のドメインを Vercel から外せませんでした", e instanceof Error ? e.message : e),
  );

  revalidatePath("/projects");
  redirect("/projects");
}

// 宣伝するものの種類を変える（決定 D34）。プロジェクトの設定の画面と、アカウント設計の AI と考える（案を採用したとき）から呼ぶ。
// 本人のプロジェクトだけ（RLS でも守る）。決まった種類だけ（DB の check でも守る）
export async function updateProductType(projectId: string, productType: ProductType): Promise<{ error?: string }> {
  if (!idSchema.safeParse(projectId).success) return { error: "プロジェクトが見つかりません" };
  if (!isProductType(productType)) return { error: "宣伝するものの種類を選んでください" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").update({ product_type: productType }).eq("id", projectId).select("id");
  if (error || !data?.length) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  return {};
}
