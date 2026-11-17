import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import type { Database } from "@/lib/supabase/database.types";
import type { QuotaVerdict, YouTubeSettings, YouTubeTarget, YouTubeUploadRow } from "@/lib/sns/adapters/youtube";

// YouTube の配信先の同意の記録（post_target_youtube）と、アップロードの途中の情報（youtube_uploads）。
// どちらもサーバーの権限で読み書きする（利用者の権限では読めない。docs/design/youtube.md の 8.）
type Admin = SupabaseClient<Database>;

// セッションの URL は、それだけで続きを送れるおそれがあるので、配信先の ID を付けて暗号化する
const sessionAad = (targetId: string) => `youtube-upload:${targetId}`;

export async function loadYouTubeTarget(admin: Admin, postTargetId: string): Promise<YouTubeTarget | null> {
  const { data: t } = await admin.from("post_targets").select("owner_id, post_id, title, sns").eq("id", postTargetId).maybeSingle();
  if (!t || t.sns !== "youtube") return null;
  const { data: s } = await admin.from("post_target_youtube").select("*").eq("post_target_id", postTargetId).eq("owner_id", t.owner_id).maybeSingle();
  return { ownerId: t.owner_id, postId: t.post_id, title: t.title ?? "", settings: s ? (s as unknown as YouTubeSettings) : null };
}

export async function loadYouTubeUpload(admin: Admin, postTargetId: string, key?: Buffer): Promise<YouTubeUploadRow | null> {
  const { data, error } = await admin.from("youtube_uploads").select("session_uri_encrypted, bytes_total, bytes_sent, video_id").eq("post_target_id", postTargetId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    sessionUri: data.session_uri_encrypted ? decryptToken(data.session_uri_encrypted, sessionAad(postTargetId), key) : null,
    bytesTotal: Number(data.bytes_total),
    bytesSent: Number(data.bytes_sent),
    videoId: data.video_id,
  };
}

// 送ったあとの処理を確かめる長さ（docs/design/youtube.md の 3.4）
export const PROCESSING_CHECK_MS = 30 * 60_000;

export async function saveYouTubeUpload(admin: Admin, postTargetId: string, ownerId: string, row: YouTubeUploadRow, now = new Date(), key?: Buffer): Promise<void> {
  const done = Boolean(row.videoId);
  const { error } = await admin.from("youtube_uploads").upsert({
    post_target_id: postTargetId,
    owner_id: ownerId,
    // 上げ終えたらセッションの URL は持たない（使わない）
    session_uri_encrypted: !done && row.sessionUri ? encryptToken(row.sessionUri, sessionAad(postTargetId), key) : null,
    bytes_total: row.bytesTotal,
    bytes_sent: row.bytesSent,
    video_id: row.videoId,
    processing_check_until: done ? new Date(now.getTime() + PROCESSING_CHECK_MS).toISOString() : null,
    updated_at: now.toISOString(),
  });
  if (error) throw error;
}

export async function clearYouTubeUpload(admin: Admin, postTargetId: string): Promise<void> {
  // 上げ終えたもの（video_id あり）は消さない（二度と上げ直さないための印）
  const { error } = await admin.from("youtube_uploads").delete().eq("post_target_id", postTargetId).is("video_id", null);
  if (error) throw error;
}

// 上限（全体 1 日 90 本・利用者ごと 5 本）は DB の関数の中の定数（20261117140000。セキュリティ確認の DB-L2）。config.ts の値とはテストでそろえる。
// scopeOwner はテスト用（全体の数をその利用者の分だけで数える。アプリからは渡さない）
export async function reserveYouTubeUpload(admin: Admin, ownerId: string, postTargetId: string, opts: { scopeOwner?: string } = {}): Promise<QuotaVerdict> {
  const { data, error } = await admin.rpc("reserve_youtube_upload", {
    p_owner_id: ownerId,
    p_post_target_id: postTargetId,
    ...(opts.scopeOwner ? { p_scope_owner: opts.scopeOwner } : {}),
  });
  if (error) throw error;
  return data === "global" || data === "user" ? data : "ok";
}
