import "server-only";
import { VIDEO_BUCKET } from "@/lib/media/video-rules";
import type { AttachedImage } from "@/components/posts/image-attachments";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { IMAGE_SCOPES, MEDIA_BUCKET, PREVIEW_URL_SECONDS, lacksImageScope } from "./rules";
import { signedUrls } from "./store";
import { postVideoRow } from "./video-store";
import { toAttached } from "./attached";


// 投稿の画像（作成画面に出す）。読めるのは本人のものだけ（RLS）。プレビューの URL は、確かめたあとにサーバーで作る。
// 整えた画像は、元の画像と最後に描き直した元（source_of でその画像を指す行）も読み、「見出しを直す」「元に戻す」が出せる形にする（4.68）
export async function loadPostImages(postId: string): Promise<AttachedImage[]> {
  const db = await createClient();
  const { data: rows, error } = await db.from("media_files").select("*").eq("post_id", postId).eq("kind", "image").order("position");
  if (error) throw error;
  const files = rows ?? [];
  const { data: sourceRows, error: srcError } = files.length ? await db.from("media_files").select("*").in("source_of", files.map((f) => f.id)) : { data: [], error: null };
  if (srcError) throw srcError;
  const sources = new Map((sourceRows ?? []).map((r) => [r.id, r]));
  const urls = await signedUrls(createAdminClient(), [...files, ...sources.values()].map((f) => f.storage_path), PREVIEW_URL_SECONDS);
  return files.map((f) => toAttached(f, urls, sources));
}

// つないだ SNS のうち、画像を送るにはつなぎ直しが要るもの。accounts は利用者の権限（RLS）で読んだ、本人のアカウント。
// 権限（scopes）はトークンの表にあり画面側からは読めないので、サーバーの権限で読む（トークンそのものは読まない）
export async function snsNeedingImageReconnect(accounts: Partial<Record<SnsKey, string>>): Promise<SnsKey[]> {
  const entries = (Object.entries(accounts) as [SnsKey, string][]).filter(([sns]) => IMAGE_SCOPES[sns]);
  if (!entries.length) return [];
  const { data, error } = await createAdminClient()
    .from("social_account_tokens")
    .select("social_account_id, scopes")
    .in("social_account_id", entries.map(([, id]) => id));
  if (error) throw error;
  const scopes = new Map((data ?? []).map((r) => [r.social_account_id, r.scopes]));
  return entries.filter(([sns, id]) => isSnsKey(sns) && lacksImageScope(sns, scopes.get(id) ?? [])).map(([sns]) => sns);
}

// 投稿の画像を保存するための URL（「TikTok に手で投稿する」で、利用者が画像を保存して TikTok のアプリから選ぶため）。
// 読めるのは本人のものだけ（RLS）。URL は保存（ダウンロード）として開く形で、1 時間で切れる
export async function loadPostImageDownloads(postId: string): Promise<{ url: string; name: string }[]> {
  const db = await createClient();
  const { data: rows, error } = await db.from("media_files").select("storage_path").eq("post_id", postId).eq("kind", "image").order("position");
  if (error) throw error;
  const files = rows ?? [];
  if (!files.length) return [];
  // 保存したときのファイルの名前（download= に入れる。PC のダウンロードで yabumi-1.jpg のようになる）。名前ごとに URL を作る
  const storage = createAdminClient().storage.from(MEDIA_BUCKET);
  const signed = await Promise.all(
    files.map(async (f, i) => {
      const name = `yabumi-${i + 1}.jpg`;
      const { data, error: signError } = await storage.createSignedUrl(f.storage_path, PREVIEW_URL_SECONDS, { download: name });
      if (signError) throw signError;
      return { url: data.signedUrl, name };
    }),
  );
  return signed;
}

// 投稿の動画を保存するための URL（「YouTube に手で投稿する」で、利用者が動画を保存して YouTube Studio で選ぶため。docs/design/youtube.md の 12.）。
// 読めるのは本人のものだけ（RLS で行を読んでから、サーバーの権限で署名する）。送り終えて消したあとは空。1 時間で切れる
export async function loadPostVideoDownload(postId: string): Promise<{ url: string; name: string }[]> {
  const row = await postVideoRow(await createClient(), postId);
  if (!row || row.removedAt) return [];
  const name = "yabumi-video.mp4";
  const { data, error } = await createAdminClient().storage.from(VIDEO_BUCKET).createSignedUrl(row.storagePath, PREVIEW_URL_SECONDS, { download: name });
  if (error) throw error;
  return [{ url: data.signedUrl, name }];
}

// 投稿の動画（作成画面・投稿の画面に出す）。読めるのは本人のものだけ（RLS）。再生の URL は押したときに作る（videoPlaybackUrl）
export async function loadPostVideo(postId: string): Promise<{ video: { id: string; durationMs: number; sizeBytes: number; localUrl: null; width: number; height: number } | null; removed: { durationMs: number } | null }> {
  const row = await postVideoRow(await createClient(), postId);
  if (!row) return { video: null, removed: null };
  if (row.removedAt) return { video: null, removed: { durationMs: row.durationMs } };
  return { video: { id: row.id, durationMs: row.durationMs, sizeBytes: row.sizeBytes, localUrl: null, width: row.width, height: row.height }, removed: null };
}
