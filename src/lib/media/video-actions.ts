"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MediaError } from "./store";
import { PREVIEW_URL_SECONDS } from "./rules";
import { discardUnattachedVideo, issueVideoUpload, postVideoRow, signedVideoUrl, verifyVideoUpload, type VideoFile } from "./video-store";

// 画面から呼ぶ、動画の添付の操作（docs/design/video.md の 3.）。動画そのものは Vercel の関数を通さず、
// ブラウザが署名つきのトークンで Storage に直接上げる（TUS）。ここではトークンの発行と、上げたあとの確かめだけを行う

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

function failure(e: unknown, fallback: string) {
  if (e instanceof MediaError) return { error: e.userMessage };
  console.error("[video]", e instanceof Error ? e.message : e);
  return { error: fallback };
}

// TUS の送り先（Supabase の資料の「直接のホスト名」。ローカルは 127.0.0.1:55321 のまま）。
// 署名つきのトークン（x-signature）で上げるときは /sign の付いた入口を使う（付けない入口は storage.objects の RLS を見るので、ポリシーのない post-videos は 403。2026-11-15 にローカルで確かめた）
function tusEndpoint(): string {
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const m = base.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (m) base.hostname = `${m[1]}.storage.supabase.co`;
  return new URL("/storage/v1/upload/resumable/sign", base).toString();
}

export type VideoUploadGrant = { path: string; token: string; endpoint: string; bucket: string };

export async function requestVideoUpload(): Promise<{ ticket?: VideoUploadGrant; error?: string }> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const t = await issueVideoUpload(createAdminClient(), userId);
    return { ticket: { path: t.path, token: t.token, endpoint: tusEndpoint(), bucket: "post-videos" } };
  } catch (e) {
    return failure(e, "動画を追加できませんでした。時間をおいてもう一度お試しください。");
  }
}

export type UploadedVideo = VideoFile & { previewUrl: string | null };

export async function confirmVideoUpload(path: string): Promise<{ video?: UploadedVideo; error?: string }> {
  if (typeof path !== "string" || path.length > 200) return { error: "入力の形式が正しくありません。" };
  const userId = await currentUserId();
  if (!userId) return { error: "ログインし直してください。" };
  const admin = createAdminClient();
  try {
    const file = await verifyVideoUpload(admin, userId, path);
    // プレビューは、上げた直後は手元の動画を使う（ここの URL は、あとから開いたとき用）
    return { video: { ...file, previewUrl: null } };
  } catch (e) {
    return failure(e, "動画を確かめられませんでした。もう一度選び直してください。");
  }
}

// まだ投稿を保存していない動画を外す。保存した投稿の動画は、投稿を保存したときに消える
export async function discardVideo(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const userId = await currentUserId();
  if (!userId) return;
  await discardUnattachedVideo(createAdminClient(), userId, id);
}

// 投稿の動画を再生する URL（押したときに作る。読むのは利用者の権限で、本人の投稿の動画だけ。URL はサーバーの権限で作る）
export async function videoPlaybackUrl(postId: string): Promise<{ url?: string; error?: string }> {
  if (!z.uuid().safeParse(postId).success) return { error: "入力の形式が正しくありません。" };
  try {
    const row = await postVideoRow(await createClient(), postId);
    if (!row) return { error: "動画が見つかりません。" };
    if (row.removedAt) return { error: "動画は送り終えたので消しました。" };
    return { url: await signedVideoUrl(createAdminClient(), row.storagePath, PREVIEW_URL_SECONDS) };
  } catch (e) {
    return failure(e, "動画を読めませんでした。");
  }
}
