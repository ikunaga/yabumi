import "server-only";
import type { AttachedImage } from "@/components/posts/image-attachments";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { IMAGE_SCOPES, PREVIEW_URL_SECONDS, lacksImageScope } from "./rules";
import { signedUrls } from "./store";
import { toAttached } from "./attached";


// 投稿の画像（作成画面に出す）。読めるのは本人のものだけ（RLS）。プレビューの URL は、確かめたあとにサーバーで作る。
// 整えた画像は、元の画像と最後に描き直した元（source_of でその画像を指す行）も読み、「見出しを直す」「元に戻す」が出せる形にする（4.68）
export async function loadPostImages(postId: string): Promise<AttachedImage[]> {
  const db = await createClient();
  const { data: rows, error } = await db.from("media_files").select("*").eq("post_id", postId).order("position");
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
