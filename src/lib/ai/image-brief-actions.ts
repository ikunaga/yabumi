"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callImageBrief } from "./anthropic";
import { MAX_BRIEF_CHARS, runImageBrief, type ImageBrief } from "./image-brief";
import { aiLimitsFromEnv } from "./limits";

export type ImageBriefActionResult = { error?: string; brief?: ImageBrief };

// 投稿の文面から、テンプレートの画像に入れる文字の案を AI が出す（F14 の段取り ①）。結果は保存しない
export async function draftImageText(projectId: string, text: unknown): Promise<ImageBriefActionResult> {
  const t = z.string().max(MAX_BRIEF_CHARS * 2).safeParse(text);
  if (!z.uuid().safeParse(projectId).success || !t.success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runImageBrief(supabase, createAdminClient(), { callBrief: callImageBrief, limits: aiLimitsFromEnv() }, { userId, projectId, text: t.data });
    return r.ok ? { brief: r.brief } : { error: r.message };
  } catch (e) {
    console.error("[draftImageText]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
