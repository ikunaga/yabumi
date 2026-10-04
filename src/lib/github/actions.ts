"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { aiConfigured, callAppDescriber, callFilePicker } from "@/lib/ai/anthropic";
import { appDescriptionSchema, composeDescription, draftAppDescription, refineAppDescription, type AppDescriptionDraft } from "@/lib/ai/app-description";
import { aiLimitsFromEnv } from "@/lib/ai/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { githubConfig, githubConfigured } from "./config";
import { repoAccess, reposForInstallation } from "./service";

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

// プロジェクトにリポジトリをつなぐ。そのインストールで本当に読めるリポジトリかを GitHub に確かめてから記録する
export async function connectRepo(projectId: string, installationId: number, repoId: number): Promise<{ error?: string }> {
  if (!z.uuid().safeParse(projectId).success || !Number.isSafeInteger(installationId) || !Number.isSafeInteger(repoId)) {
    return { error: "入力の形式が正しくありません。" };
  }
  if (!githubConfigured()) return { error: "GitHub との連携は準備中です。" };
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  const { data: inst } = await supabase.from("github_installations").select("installation_id").eq("installation_id", installationId).maybeSingle();
  if (!project || !inst) return { error: "プロジェクトか GitHub の連携が見つかりません。画面を読み込み直してください。" };

  try {
    const repo = (await reposForInstallation(githubConfig(), installationId)).find((r) => r.id === repoId);
    if (!repo) return { error: "そのリポジトリは読めません。GitHub の設定で、矢書に読ませるリポジトリに入っているか確かめてください。" };
    const { error } = await createAdminClient().from("project_github_repos").upsert({
      project_id: projectId,
      owner_id: userId,
      installation_id: installationId,
      repo_id: repo.id,
      full_name: repo.full_name,
      default_branch: repo.default_branch,
      is_private: repo.private,
      last_read_at: null,
    });
    if (error) throw error;
  } catch (e) {
    console.error("[connectRepo]", e instanceof Error ? e.message : e);
    return { error: "リポジトリをつなげませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return {};
}

export async function disconnectRepo(projectId: string) {
  if (!z.uuid().safeParse(projectId).success) return;
  const { supabase } = await currentUser();
  await supabase.from("project_github_repos").delete().eq("project_id", projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export type DraftActionResult = { error?: string; draft?: AppDescriptionDraft; description?: string; filesRead?: string[] };

// リポジトリを読んで、AI がアプリの紹介文を下書きする（保存はしない。採用したときだけ保存する）
export async function draftDescription(projectId: string): Promise<DraftActionResult> {
  if (!z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  if (!githubConfigured()) return { error: "GitHub との連携は準備中です。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です（API キーが設定されていません）。" };
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };

  try {
    const cfg = githubConfig();
    const result = await draftAppDescription(
      supabase,
      createAdminClient(),
      { callPicker: callFilePicker, callDescriber: callAppDescriber, repo: repoAccess(cfg), limits: aiLimitsFromEnv() },
      { userId, projectId },
    );
    revalidatePath(`/projects/${projectId}/github`);
    if (!result.ok) return { error: result.message };
    return { draft: result.draft, description: composeDescription(result.draft), filesRead: result.filesRead };
  } catch (e) {
    console.error("[draftDescription]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}

const answersSchema = z.array(z.object({ question: z.string().max(500), answer: z.string().max(1000) })).max(3);

// 質問への答えで、紹介文を書き直す（リポジトリは読み直さない）
export async function refineDescription(projectId: string, draft: unknown, answers: unknown): Promise<DraftActionResult> {
  if (!z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  const d = appDescriptionSchema.safeParse(draft);
  const a = answersSchema.safeParse(answers);
  if (!d.success || !a.success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です（API キーが設定されていません）。" };
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const result = await refineAppDescription(
      supabase,
      createAdminClient(),
      { callDescriber: callAppDescriber, limits: aiLimitsFromEnv() },
      { userId, projectId, draft: d.data, answers: a.data },
    );
    if (!result.ok) return { error: result.message };
    return { draft: result.draft, description: composeDescription(result.draft) };
  } catch (e) {
    console.error("[refineDescription]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}

const adoptSchema = z.object({
  description: z.string().trim().min(1, "紹介文が空です").max(2000, "紹介文は 2,000 文字以内にしてください"),
  audience: z.string().trim().max(1000, "届けたい相手は 1,000 文字以内にしてください").nullable(),
});

// 確かめて直した紹介文を、プロジェクトの「どんなアプリか」（と、選べば「届けたい相手」）に保存する
export async function adoptDescription(projectId: string, input: { description: string; audience: string | null }): Promise<{ error?: string }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  const parsed = adoptSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "入力の形式が正しくありません。" };
  const { supabase } = await currentUser();
  const update: { description: string; target_audience?: string } = { description: parsed.data.description };
  if (parsed.data.audience) update.target_audience = parsed.data.audience;
  const { data, error } = await supabase.from("projects").update(update).eq("id", projectId).select("id");
  if (error || !data?.length) return { error: "保存できませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/projects");
  redirect(`/projects/${projectId}?done=description`);
}

// 「GitHub をつなぐ（任意）」を飛ばす
export async function dismissGithubPrompt(projectId: string) {
  if (!z.uuid().safeParse(projectId).success) return;
  const { supabase } = await currentUser();
  await supabase.from("projects").update({ github_prompt_dismissed_at: new Date().toISOString() }).eq("id", projectId);
  revalidatePath(`/projects/${projectId}`, "layout");
}
