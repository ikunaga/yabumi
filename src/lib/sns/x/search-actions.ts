"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { xSearchWord, type XSearchQuota } from "./search";
import { loadXSearchQuota, runXSearch, xSearchConfigured, type XSearchResult } from "./search-server";

const NOT_READY: XSearchQuota = { remaining: 0, limit: 0, reason: "not_ready", resetsOn: null };

// X の人気の投稿を探す（4.52。押すたびに 1 回数える）。結果は返すだけで保存しない
export async function searchXBuzz(projectId: string, rawWord: unknown): Promise<XSearchResult> {
  if (!z.uuid().safeParse(projectId).success) return { ok: false, message: "入力の形式が正しくありません。", quota: NOT_READY };
  if (!xSearchConfigured()) return { ok: false, message: "yabumi の中で探すのは準備中です。", quota: NOT_READY };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { ok: false, message: "ログインし直してください。", quota: NOT_READY };
  // 本人のプロジェクトだけ（RLS）
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, message: "プロジェクトが見つかりません。", quota: NOT_READY };
  const word = xSearchWord(rawWord);
  const admin = createAdminClient();
  if (!word) {
    return { ok: false, message: "探す言葉を入れてください。", quota: await loadXSearchQuota(admin, userId) };
  }
  try {
    return await runXSearch(admin, { fetch, bearer: process.env.X_BEARER_TOKEN! }, { userId, projectId, word });
  } catch (e) {
    console.error("[searchXBuzz]", e instanceof Error ? e.message : e);
    return { ok: false, message: "うまくいきませんでした。時間をおいてもう一度お試しください。", quota: NOT_READY };
  }
}
