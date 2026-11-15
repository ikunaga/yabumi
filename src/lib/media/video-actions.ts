"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MediaError } from "./store";
import { PREVIEW_URL_SECONDS, RESTORE_UNATTACHED_HOURS } from "./rules";
import { cancelVideoUpload, checkVideoUpload, discardUnattachedVideo, issueVideoUpload, postVideoRow, signedVideoUrl, verifyVideoUpload, type VideoFile } from "./video-store";

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
// 利用者のログイン（Authorization: Bearer）のまま上げ、storage.objects の insert のポリシーを通す（/sign の入口と署名つきのトークンは使わない。
// トークンは取り消せず、確かめたあとのファイルを上書きできたため。2026-11-15 にローカルで確かめた）
function tusEndpoint(): string {
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const m = base.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (m) base.hostname = `${m[1]}.storage.supabase.co`;
  return new URL("/storage/v1/upload/resumable", base).toString();
}

export type VideoUploadGrant = { path: string; endpoint: string; bucket: string };

// 整える前に、上限に当たっていないかを確かめる（読むだけ。当たっていれば、整える時間を使わせずに知らせる）
export async function checkVideoUploadAllowed(): Promise<{ error?: string }> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    await checkVideoUpload(createAdminClient(), userId);
    return {};
  } catch (e) {
    return failure(e, "動画を追加できませんでした。時間をおいてもう一度お試しください。");
  }
}

// 上げている途中・確かめる前後に「やめる」を押したとき。本人の引換券とファイルを片付ける
export async function cancelVideo(path: string): Promise<void> {
  if (typeof path !== "string" || path.length > 200) return;
  const userId = await currentUserId();
  if (!userId) return;
  try {
    await cancelVideoUpload(createAdminClient(), userId, path);
  } catch (e) {
    console.error("[video]", e instanceof Error ? e.message : e);
  }
}

export async function requestVideoUpload(): Promise<{ ticket?: VideoUploadGrant; error?: string }> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const t = await issueVideoUpload(createAdminClient(), userId);
    return { ticket: { path: t.path, endpoint: tusEndpoint(), bucket: "post-videos" } };
  } catch (e) {
    return failure(e, "動画を追加できませんでした。時間をおいてもう一度お試しください。");
  }
}

export type UploadedVideo = VideoFile & { previewUrl: string | null };

// 投稿をつくる画面が持つ動画。localUrl: 上げた直後の手元の動画（blob の URL。画面の中だけ）。あとから開いたときは null（押したときに videoPlaybackUrl）
// width・height: 見た目の縦横（YouTube のショートになるかの案内に使う。docs/design/youtube.md の 4.）。わからなければ省く
export type AttachedVideo = { id: string; durationMs: number; sizeBytes: number; localUrl?: string | null; width?: number; height?: number };

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

// 書きかけの控えの動画を戻す（画像の restoreDraftImages と同じ考え方）。読むのは利用者の権限（RLS が本人の行に絞る）。
// 戻すのは、この投稿の動画と、まだどこにも添えていない、上げてから RESTORE_UNATTACHED_HOURS 以内の動画だけ（消したあとのものは戻さない）
export async function restoreDraftVideo(postId: unknown, id: unknown): Promise<{ video: AttachedVideo | null }> {
  const p = z.uuid().nullable().safeParse(postId);
  const v = z.uuid().safeParse(id);
  if (!p.success || !v.success) return { video: null };
  try {
    const { data } = await (await createClient()).from("media_files").select("id, post_id, created_at, duration_ms, size_bytes, removed_at, width, height").eq("id", v.data).eq("kind", "video").maybeSingle();
    if (!data || data.removed_at) return { video: null };
    const ofPost = p.data !== null && data.post_id === p.data;
    const fresh = data.post_id === null && Date.parse(data.created_at) > Date.now() - RESTORE_UNATTACHED_HOURS * 3600_000;
    if (!ofPost && !fresh) return { video: null };
    return { video: { id: data.id, durationMs: data.duration_ms ?? 0, sizeBytes: data.size_bytes, localUrl: null, width: data.width, height: data.height } };
  } catch (e) {
    console.error("[video]", e instanceof Error ? e.message : e);
    return { video: null };
  }
}
