import "server-only";
import type { AttachedImage } from "@/components/posts/image-attachments";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_URL_SECONDS } from "./rules";
import { postMedia, signedUrls } from "./store";

// 画像を送るのに、つないだときにはなかった権限が要る SNS。X は 2026-10-11 に media.write を足したので、
// それより前につないだアカウントは、つなぎ直すまで画像を送れない（docs/architecture.md の 4.17）
export const IMAGE_SCOPES: Partial<Record<SnsKey, string>> = { x: "media.write" };

export function lacksImageScope(sns: SnsKey, scopes: readonly string[]): boolean {
  const needed = IMAGE_SCOPES[sns];
  return Boolean(needed && !scopes.includes(needed));
}

// 投稿の画像（作成画面に出す）。読めるのは本人のものだけ（RLS）。プレビューの URL は、確かめたあとにサーバーで作る
export async function loadPostImages(postId: string): Promise<AttachedImage[]> {
  const files = await postMedia(await createClient(), postId);
  const urls = await signedUrls(createAdminClient(), files.map((f) => f.storagePath), PREVIEW_URL_SECONDS);
  return files.map((f) => ({
    id: f.id,
    previewUrl: urls.get(f.storagePath) ?? null,
    altText: f.altText,
    width: f.width,
    height: f.height,
    sizeBytes: f.sizeBytes,
  }));
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
