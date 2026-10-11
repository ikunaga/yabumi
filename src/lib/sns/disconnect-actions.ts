"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { revokeDeps } from "@/lib/sns/adapters";
import { revokeSnsAccess, type RevokeResult } from "@/lib/sns/revoke";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type DisconnectResult = {
  error?: string;
  // 確かめる前: 送る前の配信先（予約）の数と、ほかのプロジェクトでも使っているか
  preview?: { pending: number; otherProjects: number };
  done?: { removedAccount: boolean; revoke: RevokeResult };
};

// 「つないだ SNS」の「外す」（docs/architecture.md の 4.14）。confirmed が false なら、消す前の確認に使う数だけを返す。
// ほかのプロジェクトでも同じアカウントを使っていれば、このプロジェクトとの紐づけだけを外す（トークンは残す）。
// どこでも使わなくなるなら、SNS 側の連携を解除できるもの（X）は解除し、アカウントとトークンを消す。送信の結果（URL など）は残る
export async function disconnectSnsAccount(projectId: string, accountId: string, confirmed: boolean): Promise<DisconnectResult> {
  const ids = z.array(z.uuid()).safeParse([projectId, accountId]);
  if (!ids.success) return { error: "入力の形式が正しくありません。" };

  // 本人のものであることを、利用者の権限（RLS）で確かめる
  const supabase = await createClient();
  const { data: account } = await supabase.from("social_accounts").select("id, sns").eq("id", accountId).maybeSingle();
  const { data: links } = await supabase.from("project_social_accounts").select("project_id").eq("social_account_id", accountId);
  if (!account || !links?.some((l) => l.project_id === projectId)) return { error: "アカウントが見つかりません。画面を読み込み直してください。" };
  const otherProjects = links.filter((l) => l.project_id !== projectId).length;

  let pendingQuery = supabase
    .from("post_targets")
    .select("id, posts!inner(project_id)", { count: "exact", head: true })
    .eq("social_account_id", accountId)
    .in("status", ["pending", "preparing", "publishing"]);
  if (otherProjects > 0) pendingQuery = pendingQuery.eq("posts.project_id", projectId);
  const { count } = await pendingQuery;

  if (!confirmed) return { preview: { pending: count ?? 0, otherProjects } };

  if (otherProjects > 0) {
    const { error } = await supabase.from("project_social_accounts").delete().eq("project_id", projectId).eq("social_account_id", accountId);
    if (error) return { error: "外せませんでした。時間をおいてもう一度お試しください。" };
    revalidatePath(`/projects/${projectId}`, "layout");
    return { done: { removedAccount: false, revoke: "not_supported" } };
  }

  const revoke = await revokeSnsAccess(createAdminClient(), accountId, account.sns, revokeDeps());
  // トークンはアカウントの行からカスケードで消える。配信先からの参照は空になる（送信の結果は残る）
  const { error } = await supabase.from("social_accounts").delete().eq("id", accountId);
  if (error) return { error: "外せませんでした。時間をおいてもう一度お試しください。" };
  revalidatePath(`/projects/${projectId}`, "layout");
  return { done: { removedAccount: true, revoke } };
}
