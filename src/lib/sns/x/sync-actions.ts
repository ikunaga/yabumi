"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adapters } from "@/lib/sns/adapters";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { xConfigured, xMonthlyBudgetUsd, xPostUserMonthlyUsd } from "./config";
import { syncXTargetsOfPost } from "./sync";

// 投稿の画面を開いたときに、X の投稿がまだあるかを確かめる（24 時間に 1 回まで、1 件 $0.005。docs/architecture.md の 4.19）。
// 画面の表示（サーバー側の描画）では呼ばない。リンクの先読みで費用がかからないよう、画面を開いたあとにブラウザから呼ぶ
export async function syncXPostStatus(projectId: string, postId: string): Promise<{ changed: boolean }> {
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(postId).success) return { changed: false };
  const adapter = adapters.x;
  if (!adapter || !xConfigured()) return { changed: false };
  // 本人の投稿であることを、利用者の権限（RLS）で確かめてから、サーバーの権限で確かめに行く
  const supabase = await createClient();
  const { data: post } = await supabase.from("posts").select("id").eq("id", postId).eq("project_id", projectId).maybeSingle();
  if (!post) return { changed: false };
  try {
    const outcomes = await syncXTargetsOfPost(createAdminClient(), { publisher: {}, adapter, budgetUsd: xMonthlyBudgetUsd(), userBudgetUsd: xPostUserMonthlyUsd() }, postId);
    const changed = outcomes.some((o) => o.result === "removed");
    if (changed) revalidatePath(`/projects/${projectId}`, "layout");
    return { changed };
  } catch (e) {
    console.error("[syncXPostStatus]", e instanceof Error ? e.message : e);
    return { changed: false };
  }
}
