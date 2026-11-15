"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/user";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { youtubeChannelFor } from "./consent";

export type YouTubeChannelView = { title: string; handle: string };

// 投稿の画面の YouTube の欄を開くたびに、つないだチャンネルを読む（docs/design/youtube.md の 4.。送り先を送る前に確かめるため）。
// 本人のプロジェクト（RLS）につないだアカウントだけ
export async function getYouTubeChannel(projectId: unknown): Promise<{ channel?: YouTubeChannelView; error?: string }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "入力の形式が正しくありません。" };
  await requireUser();
  const project = await getProject(projectId as string);
  if (!project) return { error: "プロジェクトが見つかりません。" };
  const accountId = (await connectedAccounts(project.id)).youtube;
  if (!accountId) return { error: "YouTube がつながっていません。" };
  const r = await youtubeChannelFor(createAdminClient(), accountId);
  return "error" in r ? { error: r.error } : { channel: { title: r.title, handle: r.handle } };
}
