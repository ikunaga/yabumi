"use server";

import { z } from "zod";
import { loadVoiceMaterial } from "@/lib/plan/voice";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured, callVoiceMemo } from "./anthropic";
import { runVoiceMemo, type VoiceMemoDraft } from "./voice-memo";

// アカウント設計の「書き方」（docs/design/voice-from-posts.md の 3.2）: 材料の投稿の一覧と、AI に書き方を読み取ってもらう。結果は保存しない（利用者が直して「保存する」）

export type VoiceMaterialItem = { targetId: string; sns: string; head: string; publishedAt: string };

const head = (t: string) => {
  const line = t.split("\n").find((l) => l.trim()) ?? "";
  return [...line].length > 60 ? [...line].slice(0, 60).join("") + "…" : line;
};

export async function listVoiceMaterial(projectId: string): Promise<{ error?: string; items?: VoiceMaterialItem[] }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  try {
    const items = await loadVoiceMaterial(await createClient(), projectId);
    return { items: items.map((m) => ({ targetId: m.targetId, sns: m.sns, head: head(m.text), publishedAt: m.publishedAt })) };
  } catch (e) {
    console.error("[listVoiceMaterial]", e);
    return { error: "投稿を読み込めませんでした。時間をおいてもう一度お試しください。" };
  }
}

export async function draftVoiceMemo(projectId: string, exclude: unknown = []): Promise<{ error?: string; draft?: VoiceMemoDraft; sourceCount?: number }> {
  const ex = z.array(z.uuid()).max(200).safeParse(exclude);
  if (!z.uuid().safeParse(projectId).success || !ex.success) return { error: "入力の形式が正しくありません。" };
  if (!aiConfigured()) return { error: "AI はまだ準備中です。" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await runVoiceMemo(supabase, createAdminClient(), { callVoiceMemo }, { userId, projectId, exclude: ex.data });
    return r.ok ? { draft: r.draft, sourceCount: r.sourceCount } : { error: r.message };
  } catch (e) {
    console.error("[draftVoiceMemo]", e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}
