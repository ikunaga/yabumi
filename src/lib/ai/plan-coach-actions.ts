"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSectionKey } from "@/lib/plan/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callPlanCoach } from "./anthropic";
import { aiLimitsFromEnv } from "./limits";
import { coachStep, MAX_USER_TEXT, type CoachInput } from "./plan-coach";

const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start"), focus: z.string().nullable() }),
  z.object({ kind: z.literal("text"), text: z.string().max(MAX_USER_TEXT * 2) }),
  z.object({ kind: z.literal("focus"), focus: z.string() }),
  z.object({ kind: z.literal("adopt"), messageId: z.uuid(), optionIndex: z.number().int().min(0).max(2) }),
]);

export type CoachActionResult = { ok: boolean; threadId: string | null; message?: string };

// アカウント設計の会話を 1 往復進める（AI の返事を待つので、数秒〜数十秒かかる）
export async function sendCoachMessage(projectId: string, threadId: string | null, rawInput: unknown): Promise<CoachActionResult> {
  if (!z.uuid().safeParse(projectId).success || (threadId !== null && !z.uuid().safeParse(threadId).success)) {
    return { ok: false, threadId, message: "入力の形式が正しくありません。" };
  }
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, threadId, message: "入力の形式が正しくありません。" };
  const raw = parsed.data;
  let input: CoachInput;
  if (raw.kind === "start") input = { kind: "start", focus: raw.focus && isSectionKey(raw.focus) ? raw.focus : null };
  else if (raw.kind === "focus") {
    if (!isSectionKey(raw.focus)) return { ok: false, threadId, message: "入力の形式が正しくありません。" };
    input = { kind: "focus", focus: raw.focus };
  } else input = raw;

  if (!aiConfigured()) return { ok: false, threadId, message: "AI はまだ準備中です（API キーが設定されていません）。設計の画面で手で入力できます。" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { ok: false, threadId, message: "ログインし直してください。" };

  try {
    const result = await coachStep(supabase, createAdminClient(), { callModel: callPlanCoach, limits: aiLimitsFromEnv() }, { userId, projectId, threadId, input });
    revalidatePath(`/projects/${projectId}`, "layout");
    return result.ok ? { ok: true, threadId: result.threadId } : { ok: false, threadId: result.threadId, message: result.message };
  } catch (e) {
    console.error("[sendCoachMessage]", e);
    return { ok: false, threadId, message: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
