"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/user";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { tiktokCreatorFor } from "./consent";

export type TikTokCreatorView = {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  canDirect: boolean;
  canInbox: boolean;
  audited: boolean;
};

// 投稿の画面の TikTok の欄を開くたびに、つないだ TikTok のいまの状態を読む（docs/design/tiktok.md の 3. の 1）。
// 本人のプロジェクト（RLS）につないだアカウントだけ。アイコンの URL は 2 時間で切れるので、保存しない
export async function getTikTokCreator(projectId: unknown): Promise<{ creator?: TikTokCreatorView; error?: string }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  await requireUser();
  const project = await getProject(projectId as string);
  if (!project) return { error: "プロジェクトが見つかりません。" };
  const accountId = (await connectedAccounts(project.id)).tiktok;
  if (!accountId) return { error: "TikTok がつながっていません。" };
  const r = await tiktokCreatorFor(createAdminClient(), accountId);
  return "error" in r ? { error: r.error } : { creator: r };
}
