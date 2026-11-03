"use server";

import { z } from "zod";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callImageBrief } from "./anthropic";
import { MAX_BRIEF_CHARS, runImageBrief, type ImageBrief } from "./image-brief";
import { aiLimitsFromEnv } from "./limits";

const snsListSchema = z.array(z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]])).max(SNS_KEYS.length);

export type ImageBriefActionResult = { error?: string; brief?: ImageBrief };

// 投稿の文面から、テンプレートの画像に入れる文字の案を AI が出す（F14 の段取り ①）。結果は保存しない
// sns: 送り先の SNS（投稿の柱は、この SNS に付いたものだけを材料にする）
export async function draftImageText(projectId: string, text: unknown, sns: unknown = []): Promise<ImageBriefActionResult> {
  const t = z.string().max(MAX_BRIEF_CHARS * 2).safeParse(text);
  const s = snsListSchema.safeParse(sns);
  if (!z.uuid().safeParse(projectId).success || !t.success || !s.success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runImageBrief(supabase, createAdminClient(), { callBrief: callImageBrief, limits: aiLimitsFromEnv() }, { userId, projectId, text: t.data, sns: s.data });
    return r.ok ? { brief: r.brief } : { error: r.message };
  } catch (e) {
    console.error("[draftImageText]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
