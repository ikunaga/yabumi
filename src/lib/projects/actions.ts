"use server";

import { revalidatePath } from "next/cache";
import { isProductType, type ProductType } from "./product-types";
import { redirect } from "next/navigation";
import { z } from "zod";
import { defaultLinkDomainDeps, drainLinkDomainRemovals } from "@/lib/links/domains";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseDestinationsForm, saveDestinations } from "./destinations";
import { parseProjectForm, toFieldErrors, type ProjectFieldErrors } from "./schema";

export type ProjectFormState = {
  error?: string;
  fieldErrors?: ProjectFieldErrors;
  values?: Record<string, string>;
};

const idSchema = z.uuid();

function echoValues(formData: FormData) {
  const values: Record<string, string> = {};
  for (const key of ["product_type", "name", "description", "target_audience", "app_store_url", "play_store_url"]) {
    values[key] = String(formData.get(key) ?? "");
  }
  return values;
}

export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const parsed = parseProjectForm(formData);
  const dest = parseDestinationsForm(formData);
  if (!parsed.success || !dest.ok) {
    return { fieldErrors: parsed.success ? {} : toFieldErrors(parsed.error), error: dest.ok ? undefined : dest.error, values: echoValues(formData) };
  }

  const supabase = await createClient();
  // アプリでなければ、ストアの URL は入れない（欄も出していない）
  const row = parsed.data.product_type === "app" ? parsed.data : { ...parsed.data, app_store_url: null, play_store_url: null };
  const { data, error } = await supabase.from("projects").insert(row).select("id").single();
  if (error) {
    return { error: "プロジェクトを作成できませんでした。時間をおいてもう一度お試しください。", values: echoValues(formData) };
  }
  try {
    await saveDestinations(supabase, data.id, dest.items);
  } catch (e) {
    console.error("[createProject] 行き先の URL を保存できませんでした", e instanceof Error ? e.message : e);
    redirect(`/projects/${data.id}/edit?done=destinations_failed`);
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
  const dest = parseDestinationsForm(formData);
  if (!parsed.success || !dest.ok) {
    return { fieldErrors: parsed.success ? {} : toFieldErrors(parsed.error), error: dest.ok ? undefined : dest.error, values: echoValues(formData) };
  }

  const supabase = await createClient();
  // アプリでなければストアの URL の欄を出していないので、入っている値は変えない（アプリに戻したときのため）
  const { app_store_url, play_store_url, ...rest } = parsed.data;
  const row = parsed.data.product_type === "app" ? { ...rest, app_store_url, play_store_url } : rest;
  const { data, error } = await supabase.from("projects").update(row).eq("id", id).select("id");
  if (error || data.length === 0) {
    return { error: "保存できませんでした。時間をおいてもう一度お試しください。", values: echoValues(formData) };
  }
  try {
    await saveDestinations(supabase, id, dest.items);
  } catch (e) {
    console.error("[updateProject] 行き先の URL を保存できませんでした", e instanceof Error ? e.message : e);
    return { error: "行き先の URL を保存できませんでした。時間をおいてもう一度お試しください。", values: echoValues(formData) };
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
