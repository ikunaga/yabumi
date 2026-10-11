import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { InvalidImageError, sanitizeJpeg } from "./jpeg";
import {
  MAX_ALT_LENGTH,
  MAX_DIMENSION,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_POST,
  MAX_UNATTACHED,
  MEDIA_BUCKET,
  SNS_FETCH_URL_SECONDS,
  USER_QUOTA_BYTES,
  KEEP_AFTER_SENT_DAYS,
  formatBytes,
  isOwnMediaPath,
  mediaPath,
} from "./rules";

// 画像の確認・添付・片付け（docs/architecture.md の 4.18）。admin は RLS を通らないクライアント。
// 呼ぶ側で、ownerId がログイン中の利用者であることを確かめておく

type Admin = SupabaseClient<Database>;

export type MediaFile = { id: string; width: number; height: number; sizeBytes: number; altText: string; storagePath: string };

export class MediaError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "MediaError";
  }
}

function toMediaFile(row: { id: string; width: number; height: number; size_bytes: number; alt_text: string; storage_path: string }): MediaFile {
  return { id: row.id, width: row.width, height: row.height, sizeBytes: row.size_bytes, altText: row.alt_text, storagePath: row.storage_path };
}

async function removeObjects(admin: Admin, paths: string[]) {
  if (!paths.length) return;
  const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths);
  if (error) console.error("[media] 画像を消せませんでした", error.message);
}

// 確かめ待ちの引換券の上限（URL を発行したが、まだ確かめていないもの）
export const MAX_PENDING_TICKETS = 10;

export type UploadTicket = { path: string; token: string; signedUrl: string };

// 画像を 1 枚上げるための、署名つきのアップロード URL を発行する（その場所にだけ、2 時間上げられる）。
// 上げる前に、確かめ待ちの数・添えていない画像の数・容量を確かめる
export async function issueUpload(admin: Admin, ownerId: string, id: string = crypto.randomUUID()): Promise<UploadTicket> {
  const path = mediaPath(ownerId, id);
  // 上限の確認と引換券の記録は、DB の中で利用者ごとに順に行う（同時に頼まれても上限を超えない）
  const { data: status, error: ticketError } = await admin.rpc("issue_media_upload_ticket", {
    p_owner_id: ownerId,
    p_storage_path: path,
    p_max_pending: MAX_PENDING_TICKETS,
    p_max_unattached: MAX_UNATTACHED,
    p_quota_bytes: USER_QUOTA_BYTES,
    p_max_file_bytes: MAX_IMAGE_BYTES,
  });
  if (ticketError) throw ticketError;
  if (status === "too_many_pending") throw new MediaError("画像の追加が続いています。少し待ってからもう一度お試しください。");
  if (status === "too_many_unattached") {
    throw new MediaError(`保存していない画像が ${MAX_UNATTACHED} 枚あります。投稿を保存するか、要らない画像を外してから追加してください。`);
  }
  if (status === "quota") {
    throw new MediaError(`置ける画像の合計（${formatBytes(USER_QUOTA_BYTES)}）に近づいています。送り終えた画像は ${KEEP_AFTER_SENT_DAYS} 日で消えます。要らない下書きの画像を外してください。`);
  }
  if (status !== "ok") throw new Error(`引換券を発行できませんでした（${status}）`);

  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    await admin.from("media_upload_tickets").delete().eq("storage_path", path);
    throw error ?? new Error("アップロードの URL を作れませんでした");
  }
  return { path, token: data.token, signedUrl: data.signedUrl };
}

// ブラウザが Storage に直接上げた画像を確かめる。JPEG か（中身で）、大きさ、上限を確かめ、
// 位置情報などのメタデータを消して置き直してから記録する。だめなら画像を消して MediaError
export async function verifyUpload(admin: Admin, ownerId: string, path: string): Promise<MediaFile> {
  if (!isOwnMediaPath(ownerId, path)) throw new MediaError("画像の置き場所が正しくありません。もう一度選び直してください。");

  const { data: existing } = await admin.from("media_files").select("*").eq("storage_path", path).maybeSingle();
  if (existing) {
    if (existing.owner_id !== ownerId) throw new MediaError("画像の置き場所が正しくありません。");
    return toMediaFile(existing);
  }

  // サーバーが発行した場所だけを受け付ける
  const { data: ticket } = await admin.from("media_upload_tickets").select("storage_path").eq("storage_path", path).eq("owner_id", ownerId).maybeSingle();
  if (!ticket) throw new MediaError("画像の置き場所が正しくありません。もう一度選び直してください。");

  try {
    const { data: used, error: usedError } = await admin.rpc("media_usage_bytes", { p_owner_id: ownerId });
    if (usedError) throw usedError;

    const { data: blob, error } = await admin.storage.from(MEDIA_BUCKET).download(path);
    if (error || !blob) throw new MediaError("画像を読めませんでした。もう一度選び直してください。");
    if (blob.size > MAX_IMAGE_BYTES) throw new MediaError(`画像が大きすぎます（${formatBytes(blob.size)}）。${formatBytes(MAX_IMAGE_BYTES)} までです。`);

    let clean;
    try {
      clean = sanitizeJpeg(new Uint8Array(await blob.arrayBuffer()));
    } catch (e) {
      if (e instanceof InvalidImageError) throw new MediaError("画像として読めませんでした。JPEG・PNG などの写真や画像を選んでください。");
      throw e;
    }
    if (clean.width > MAX_DIMENSION || clean.height > MAX_DIMENSION) throw new MediaError("画像の縦横が大きすぎます。");
    if (Number(used ?? 0) + clean.bytes.length > USER_QUOTA_BYTES) {
      throw new MediaError(`置ける画像の合計（${formatBytes(USER_QUOTA_BYTES)}）を超えます。送り終えた画像は ${KEEP_AFTER_SENT_DAYS} 日で消えます。要らない下書きの画像を外してください。`);
    }

    // メタデータを消したものに置き直す（利用者は上書きできないので、確かめたあとに差し替えられることはない）
    const { error: upError } = await admin.storage
      .from(MEDIA_BUCKET)
      .update(path, clean.bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
    if (upError) throw upError;

    const { data: row, error: insError } = await admin
      .from("media_files")
      .insert({ owner_id: ownerId, storage_path: path, width: clean.width, height: clean.height, size_bytes: clean.bytes.length })
      .select("*")
      .single();
    if (insError) throw insError;
    await admin.from("media_upload_tickets").delete().eq("storage_path", path);
    return toMediaFile(row);
  } catch (e) {
    await removeObjects(admin, [path]);
    await admin.from("media_upload_tickets").delete().eq("storage_path", path);
    throw e;
  }
}

export type AttachItem = { id: string; altText: string };

// 投稿の画像を、渡した順と代わりの文にそろえる。外された画像は消す。
// 投稿が本人のものであること、画像が本人のもので、まだどこにも添えていないか同じ投稿のものであることを確かめる
export async function attachMedia(admin: Admin, ownerId: string, postId: string, items: AttachItem[]): Promise<void> {
  if (items.length > MAX_IMAGES_PER_POST) throw new MediaError(`画像は 1 つの投稿に ${MAX_IMAGES_PER_POST} 枚までです。`);
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new MediaError("同じ画像が 2 回入っています。");
  for (const i of items) {
    if (i.altText.length > MAX_ALT_LENGTH) throw new MediaError(`代わりの文は ${MAX_ALT_LENGTH} 字までです。`);
  }

  const { data: post } = await admin.from("posts").select("id").eq("id", postId).eq("owner_id", ownerId).maybeSingle();
  if (!post) throw new MediaError("投稿が見つかりません。");

  const ids = items.map((i) => i.id);
  if (ids.length) {
    const { data: rows, error } = await admin.from("media_files").select("id, post_id").eq("owner_id", ownerId).in("id", ids);
    if (error) throw error;
    const ok = new Map((rows ?? []).filter((r) => r.post_id === null || r.post_id === postId).map((r) => [r.id, r]));
    if (ids.some((id) => !ok.has(id))) throw new MediaError("見つからない画像があります。画面を読み込み直してください。");
    for (const [position, item] of items.entries()) {
      const { error: e } = await admin
        .from("media_files")
        .update({ post_id: postId, position, alt_text: item.altText.trim() })
        .eq("id", item.id)
        .eq("owner_id", ownerId);
      if (e) throw e;
    }
  }

  // この投稿から外された画像は、ファイルごと消す
  let removed = admin.from("media_files").select("id, storage_path").eq("owner_id", ownerId).eq("post_id", postId);
  if (ids.length) removed = removed.not("id", "in", `(${ids.join(",")})`);
  const { data: gone, error: goneError } = await removed;
  if (goneError) throw goneError;
  if (gone?.length) {
    await removeObjects(admin, gone.map((g) => g.storage_path));
    const { error: delError } = await admin.from("media_files").delete().in("id", gone.map((g) => g.id));
    if (delError) throw delError;
  }
}

// 保存していない画像を外す（画面の「外す」）。投稿に添えた画像は、投稿を保存したときに attachMedia が消す
export async function discardUnattached(admin: Admin, ownerId: string, id: string): Promise<void> {
  const { data } = await admin.from("media_files").select("id, storage_path").eq("id", id).eq("owner_id", ownerId).is("post_id", null).maybeSingle();
  if (!data) return;
  await removeObjects(admin, [data.storage_path]);
  await admin.from("media_files").delete().eq("id", data.id);
}

// 投稿の画像（並び順）
export async function postMedia(db: SupabaseClient<Database>, postId: string): Promise<MediaFile[]> {
  const { data, error } = await db.from("media_files").select("*").eq("post_id", postId).order("position");
  if (error) throw error;
  return (data ?? []).map(toMediaFile);
}

// 期限つきの URL（画面のプレビューと、SNS が取りに来るとき）
export async function signedUrls(db: SupabaseClient<Database>, paths: string[], seconds: number): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUrls(paths, seconds);
  if (error) throw error;
  return new Map((data ?? []).flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as const] : [])));
}

export async function downloadMedia(admin: Admin, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) throw new Error(`画像を読めませんでした（${path}）`);
  return new Uint8Array(await data.arrayBuffer());
}

// 毎日の片付け: 添えないまま 1 日たった画像、投稿が消えた画像、送り終えて 30 日たった画像、記録のないファイルを消す
// ownerId を渡すとその利用者の分だけ（結合テスト用。毎日のジョブは全体）
export async function cleanupMedia(admin: Admin, { limit = 200, ownerId }: { limit?: number; ownerId?: string } = {}): Promise<{ removed: number }> {
  const { data, error } = await admin.rpc("cleanup_media_candidates", { p_limit: limit, ...(ownerId ? { p_owner_id: ownerId } : {}) });
  if (error) throw error;
  if (!data.length) return { removed: 0 };
  const { error: rmError } = await admin.storage.from(MEDIA_BUCKET).remove(data.map((d) => d.storage_path));
  if (rmError) throw rmError;
  const ids = data.map((d) => d.media_id).filter((id): id is string => Boolean(id));
  if (ids.length) {
    const { error: delError } = await admin.from("media_files").delete().in("id", ids);
    if (delError) throw delError;
  }
  return { removed: data.length };
}

// 送るときの画像（並び順）。URL は送る直前に作る期限つきの署名 URL（SNS_FETCH_URL_SECONDS）。予約の時刻とは関係しない
export async function publishImagesFor(admin: Admin, postId: string): Promise<{ url: string; altText: string; load: () => Promise<Uint8Array> }[]> {
  const files = await postMedia(admin, postId);
  if (!files.length) return [];
  const urls = await signedUrls(admin, files.map((f) => f.storagePath), SNS_FETCH_URL_SECONDS);
  return files.map((f) => {
    const url = urls.get(f.storagePath);
    if (!url) throw new Error(`画像の URL を作れませんでした（${f.storagePath}）`);
    return { url, altText: f.altText, load: () => downloadMedia(admin, f.storagePath) };
  });
}
