"use server";

import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callShortenDrafts, callTidyDraft } from "./anthropic";
import { aiLimitsFromEnv } from "./limits";
import { MAX_TIDY_CHARS, runTidyDraft } from "./tidy-draft";
import type { TidyOption } from "./tidy-draft-apply";

const inputSchema = z.object({
  text: z.string().max(MAX_TIDY_CHARS * 2),
  sns: z.array(z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]])).max(SNS_KEYS.length),
});

export type TidyDraftActionResult = { error?: string; options?: TidyOption[] };

// 本文（話し言葉など）を、選んだ SNS ごとの投稿の案に整える（docs/architecture.md の 4.34）。結果は保存しない
export async function tidyPostDraft(projectId: string, input: unknown): Promise<TidyDraftActionResult> {
  const t = inputSchema.safeParse(input);
  if (!z.uuid().safeParse(projectId).success || !t.success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runTidyDraft(
      supabase,
      createAdminClient(),
      { callTidy: callTidyDraft, callShorten: callShortenDrafts, limits: aiLimitsFromEnv() },
      { userId, projectId, text: t.data.text, sns: t.data.sns },
    );
    return r.ok ? { options: r.options } : { error: r.message };
  } catch (e) {
    console.error("[tidyPostDraft]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
