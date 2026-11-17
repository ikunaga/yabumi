"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hashtagsInput } from "@/lib/post-formats/schema";
import { createClient } from "@/lib/supabase/server";
import type { DefaultHashtags } from "./default-hashtags";

export type DefaultHashtagsResult = { ok: true; hashtags: DefaultHashtags } | { ok: false; error: string };

const FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";

// いつものタグを保存する（プロジェクトの設定）。値はキーごとに「#a #b」の文字。決まりは投稿のフォーマットのタグと同じ（hashtagsInput。DB の check は守りの二重化）
export async function saveDefaultHashtags(projectId: string, raw: Record<string, string>): Promise<DefaultHashtagsResult> {
  if (!z.uuid().safeParse(projectId).success) return { ok: false, error: "プロジェクトが見つかりません。" };
  const p = hashtagsInput.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "入力の形式が正しくありません。" };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return { ok: false, error: "ログインし直してください。" };
  // RLS で本人のプロジェクトだけ。他人の id なら 0 行
  const { data, error } = await db.from("projects").update({ default_hashtags: p.data }).eq("id", projectId).select("id");
  if (error) {
    console.error("[default-hashtags]", error.code, error.message);
    return { ok: false, error: FAILED };
  }
  if (!data?.length) return { ok: false, error: "プロジェクトが見つかりません。" };
  revalidatePath(`/projects/${projectId}/edit`);
  revalidatePath(`/projects/${projectId}/compose`);
  return { ok: true, hashtags: p.data };
}
