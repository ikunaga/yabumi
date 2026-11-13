"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callFormatRound, callPostFormat } from "./anthropic";
import { runFormatRound, type RoundProposal } from "./format-round-ai";
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

// シリーズの次の回の案（docs/design/format-series.md の 3）。案は保存しない（選んで「本文に入れる」と、シリーズの記録に残る）
export async function draftFormatRound(projectId: string, formatId: string, wish: unknown): Promise<{ error?: string; proposals?: RoundProposal[]; left?: number; dropped?: number; empty?: boolean }> {
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(formatId).success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runFormatRound(supabase, createAdminClient(), { callFormatRound }, { userId, projectId, formatId, wish });
    return r.ok ? { proposals: r.proposals, left: r.left, dropped: r.dropped } : { error: r.message, left: r.left, empty: r.empty };
  } catch (e) {
    console.error("[draftFormatRound]", e instanceof Error ? e.message : e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
