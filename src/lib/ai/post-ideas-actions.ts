"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isValidPeriod } from "@/lib/github/commit-reader";
import { githubConfig, githubConfigured } from "@/lib/github/config";
import { readCommitsForIdeas } from "@/lib/github/service";
import { connectedAccounts } from "@/lib/posts/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callPostIdeas } from "./anthropic";
import { aiLimitsFromEnv } from "./limits";
import { adoptPostIdea, generatePostIdeas, MAX_ANSWER_CHARS, MAX_IDEA_QUESTIONS, MAX_IDEAS, MAX_NEWS_CHARS, NEWS_QUESTIONS, refinePostIdeas } from "./post-ideas";

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

export type IdeasActionResult = { error?: string };

const BAD_INPUT = { error: "入力の形式が正しくありません。" };
const FAILED = { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };

const inputSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("commits"), days: z.number().refine(isValidPeriod) }),
  z.object({ source: z.literal("news"), news: z.array(z.object({ question: z.string().max(500), answer: z.string().max(MAX_NEWS_CHARS) })).max(NEWS_QUESTIONS.length) }),
  z.object({ source: z.literal("plan") }),
]);

// 材料（最近のコミット・最近のできごと・アカウント設計）から、AI が投稿のネタを出す（30〜90 秒ほどかかる）
export async function generateIdeas(projectId: string, input: unknown, sns: unknown): Promise<IdeasActionResult> {
  const snsList = z.array(z.string()).max(10).safeParse(sns);
  const parsed = inputSchema.safeParse(input);
  if (!z.uuid().safeParse(projectId).success || !parsed.success || !snsList.success) return BAD_INPUT;
  if (parsed.data.source === "commits" && !githubConfigured()) return { error: "GitHub との連携は準備中です。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です（API キーが設定されていません）。" };
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };

  try {
    const r = await generatePostIdeas(
      supabase,
      createAdminClient(),
      { callIdeas: callPostIdeas, readCommits: (link, since) => readCommitsForIdeas(githubConfig(), link, since), limits: aiLimitsFromEnv() },
      { userId, projectId, sns: snsList.data, input: parsed.data },
    );
    if (!r.ok) return { error: r.message };
  } catch (e) {
    console.error("[generateIdeas]", e);
    return FAILED;
  }
  revalidatePath(`/projects/${projectId}/ideas`);
  return {};
}

const answersSchema = z.array(z.object({ question: z.string().max(500), answer: z.string().max(MAX_ANSWER_CHARS) })).max(MAX_IDEA_QUESTIONS);

// 質問への答えで、ネタを出し直す（コミットは読み直さない）
export async function refineIdeas(projectId: string, threadId: string, answers: unknown): Promise<IdeasActionResult> {
  const a = answersSchema.safeParse(answers);
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(threadId).success || !a.success) return BAD_INPUT;
  if (!aiConfigured()) return { error: "AI はまだ準備中です（API キーが設定されていません）。" };
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await refinePostIdeas(supabase, createAdminClient(), { callIdeas: callPostIdeas, limits: aiLimitsFromEnv() }, { userId, projectId, threadId, answers: a.data });
    if (!r.ok) return { error: r.message };
  } catch (e) {
    console.error("[refineIdeas]", e);
    return FAILED;
  }
  revalidatePath(`/projects/${projectId}/ideas`);
  return {};
}

// 選んだネタを「投稿をつくる」の下書きとして保存し、投稿の画面を開く
export async function adoptIdea(projectId: string, messageId: string, index: number): Promise<IdeasActionResult> {
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(messageId).success || !Number.isInteger(index) || index < 0 || index >= MAX_IDEAS) return BAD_INPUT;
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  let postId: string;
  try {
    const r = await adoptPostIdea(supabase, createAdminClient(), { userId, projectId, messageId, index, accounts: await connectedAccounts(projectId) });
    if (!r.ok) return { error: r.message };
    postId = r.postId;
  } catch (e) {
    console.error("[adoptIdea]", e);
    return FAILED;
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/posts/${postId}?done=idea`);
}
