"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callPostFormat } from "./anthropic";
import { runPostFormatDraft, type FormatProposal } from "./post-format-ai";

// 投稿のフォーマットを AI とつくる（docs/design/post-formats.md の 3）。案は保存しない（利用者が選んで直して「保存する」）
export async function draftPostFormats(projectId: string, ask: { kind?: unknown; must?: unknown; refine?: unknown }): Promise<{ error?: string; proposals?: FormatProposal[] }> {
  if (!z.uuid().safeParse(projectId).success || !ask || typeof ask !== "object") return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runPostFormatDraft(supabase, createAdminClient(), { callPostFormat }, { userId, projectId, kind: ask.kind, must: ask.must, refine: ask.refine });
    return r.ok ? { proposals: r.proposals } : { error: r.message };
  } catch (e) {
    console.error("[draftPostFormats]", e instanceof Error ? e.message : e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
