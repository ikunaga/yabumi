"use server";

import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MAX_CHECK_CHARS, runAiCheck, type AiCheckResult } from "./ai-check";
import { aiConfigured, callAiCheck } from "./anthropic";
import { aiLimitsFromEnv } from "./limits";

const textsSchema = z
  .array(z.object({ sns: z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]), text: z.string().max(MAX_CHECK_CHARS) }))
  .min(1)
  .max(SNS_KEYS.length);

export type AiCheckActionResult = { error?: string; result?: AiCheckResult };

// 送る前の文面を AI が確かめる（AI っぽさチェック、F11）。結果は保存しない
export async function checkPostTexts(projectId: string, texts: unknown): Promise<AiCheckActionResult> {
  const t = textsSchema.safeParse(texts);
  if (!z.uuid().safeParse(projectId).success || !t.success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です（API キーが設定されていません）。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runAiCheck(supabase, createAdminClient(), { callCheck: callAiCheck, limits: aiLimitsFromEnv() }, { userId, projectId, texts: t.data });
    return r.ok ? { result: r.result } : { error: r.message };
  } catch (e) {
    console.error("[checkPostTexts]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
