import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { InvalidImageError, sanitizeJpeg, withAiMark, type AiSource } from "./jpeg";
import type { MediaEdit } from "./edit-schema";
import {
  MAX_ALT_LENGTH,
  MAX_DIMENSION,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_POST,
  MAX_UNATTACHED,
  MEDIA_BUCKET,
  RESTORE_UNATTACHED_HOURS,
  SNS_FETCH_URL_SECONDS,
  USER_QUOTA_BYTES,
  KEEP_AFTER_SENT_DAYS,
  formatBytes,
  isOwnMediaPath,
  mediaPath,
  unattachedLimitMessage,
} from "./rules";

// 画像の確認・添付・片付け（docs/architecture.md の 4.18）。admin は RLS を通らないクライアント。
// 呼ぶ側で、ownerId がログイン中の利用者であることを確かめておく

type Admin = SupabaseClient<Database>;

// aiGenerated: AI で作った画像（画面に札を出す。画像には IPTC の印が入っている）
export type MediaFile = { id: string; width: number; height: number; sizeBytes: number; altText: string; storagePath: string; aiGenerated: boolean };

export class MediaError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "MediaError";
  }
}

function toMediaFile(row: { id: string; width: number; height: number; size_bytes: number; alt_text: string; storage_path: string; ai_generated: boolean }): MediaFile {
  return { id: row.id, width: row.width, height: row.height, sizeBytes: row.size_bytes, altText: row.alt_text, storagePath: row.storage_path, aiGenerated: row.ai_generated };
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
    throw new MediaError(unattachedLimitMessage());
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
// 位置情報などのメタデータを消して置き直してから記録する。だめなら画像を消して MediaError。
// ai を渡すと（AI で作った画像から作ったと、呼ぶ側が確かめたとき）、消したあとに AI の印（IPTC）を入れ、ai_generated を付ける
export async function verifyUpload(admin: Admin, ownerId: string, path: string, opts: { ai?: AiSource } = {}): Promise<MediaFile> {
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
    if (opts.ai) clean = { ...clean, bytes: withAiMark(clean.bytes, opts.ai) };
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
      .insert({ owner_id: ownerId, storage_path: path, width: clean.width, height: clean.height, size_bytes: clean.bytes.length, ai_generated: Boolean(opts.ai) })
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

// 整えた画像は、元の画像（originalId）・最後に描き直した元（editBaseId）・整え方（edit）・文字が入っているか（hasText）も渡す（4.68）
export type AttachItem = { id: string; altText: string; originalId?: string; editBaseId?: string; edit?: MediaEdit; hasText?: boolean };

// 投稿の画像を、渡した順と代わりの文にそろえる。外された画像は消す。
// 投稿が本人のものであること、画像が本人のもので、まだどこにも添えていないか同じ投稿のものであることを確かめる。
// 整えた画像の元（4.68）は、投稿に添えずに source_of でその画像を指し、その画像が消えたら一緒に消える（DB の on delete cascade）。
// 元が本人のものでない・ほかの投稿やメモのもの・ほかの画像の元のときは、整え方を持たせない（保存は止めない）
export async function attachMedia(admin: Admin, ownerId: string, postId: string, items: AttachItem[]): Promise<void> {
  if (items.length > MAX_IMAGES_PER_POST) throw new MediaError(`画像は 1 つの投稿に ${MAX_IMAGES_PER_POST} 枚までです。`);
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new MediaError("同じ画像が 2 回入っています。");
  for (const i of items) {
    if (i.altText.length > MAX_ALT_LENGTH) throw new MediaError(`画像の説明文は ${MAX_ALT_LENGTH} 字までです。`);
  }

  const { data: post } = await admin.from("posts").select("id").eq("id", postId).eq("owner_id", ownerId).maybeSingle();
  if (!post) throw new MediaError("投稿が見つかりません。");

  // いまこの投稿に添えてある画像（元に戻した画像は、その画像の元だったものなので、ここを手がかりに確かめる）
  const { data: current, error: curError } = await admin.from("media_files").select("id").eq("owner_id", ownerId).eq("post_id", postId);
  if (curError) throw curError;
  const currentIds = new Set((current ?? []).map((r) => r.id));
  const ids = items.map((i) => i.id);
  const sourceIds = [...new Set(items.flatMap((i) => [i.originalId, i.editBaseId]).filter((x): x is string => Boolean(x)))].filter((x) => !ids.includes(x));
  const all = [...new Set([...ids, ...sourceIds])];
  const { data: rows, error } = all.length ? await admin.from("media_files").select("id, post_id, note_id, source_of").eq("owner_id", ownerId).in("id", all) : { data: [], error: null };
  if (error) throw error;
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  // 元の画像として使ってよいもの: 本人の、投稿にもメモにも添えていない画像で、ほかの投稿の画像の元でないもの。
  // 同じ保存で添える画像（その画像自身も）は元にしない（添える画像を元にすると、DB の check で保存が途中で止まる。セキュリティ確認 2026-11-13 の App-L1）
  const sourceOk = (id: string | undefined, itemId: string) => {
    if (!id || id === itemId || ids.includes(id)) return false;
    const r = byId.get(id);
    return Boolean(r && r.post_id === null && r.note_id === null && (r.source_of === null || currentIds.has(r.source_of) || ids.includes(r.source_of)));
  };
  for (const id of ids) {
    const r = byId.get(id);
    // 添える画像: まだどこにも添えていないか同じ投稿のもの。元の画像を添え直す（元に戻す）なら、この投稿の画像の元だったものだけ
    const ok = r && r.note_id === null && (r.post_id === postId || (r.post_id === null && (r.source_of === null || currentIds.has(r.source_of))));
    if (!ok) throw new MediaError("見つからない画像があります。画面を読み込み直してください。");
  }

  // 判定を先に済ませてから書き込む（途中で止まって中途半端な状態を残さない）。整え方を持たせる画像と、その元
  const keeps = new Map(
    items.filter((i) => i.edit && i.originalId && i.editBaseId && sourceOk(i.originalId, i.id) && sourceOk(i.editBaseId, i.id)).map((i) => [i.id, i]),
  );
  // 同じ元を 2 つの画像の元にしない（1 つの元の行は 1 つの画像だけを指せる）。先に出てきた画像だけに持たせる
  const claimed = new Set<string>();
  for (const [id, i] of [...keeps]) {
    const mine = [...new Set([i.originalId!, i.editBaseId!])];
    if (mine.some((m) => claimed.has(m))) keeps.delete(id);
    else for (const m of mine) claimed.add(m);
  }

  if (ids.length) {
    // 添え直す画像が元の画像だったときは、元の印を外してから添える（DB の check: 元の画像は投稿に添えない）
    const { error: clearError } = await admin.from("media_files").update({ source_of: null }).eq("owner_id", ownerId).in("id", ids).not("source_of", "is", null);
    if (clearError) throw clearError;
    for (const [position, item] of items.entries()) {
      const keep = keeps.has(item.id);
      const { error: e } = await admin
        .from("media_files")
        .update({
          post_id: postId,
          position,
          alt_text: item.altText.trim(),
          original_id: keep ? item.originalId! : null,
          edit_base_id: keep ? item.editBaseId! : null,
          edit: keep ? item.edit! : null,
          has_text: item.hasText ?? null,
        })
        .eq("id", item.id)
        .eq("owner_id", ownerId);
      if (e) throw e;
      if (keep) {
        const { error: se } = await admin.from("media_files").update({ source_of: item.id }).eq("owner_id", ownerId).in("id", [...new Set([item.originalId!, item.editBaseId!])]);
        if (se) throw se;
      }
    }
  }

  // この投稿の画像の元のうち、もう使っていないもの（整え直した・元に戻した）は、ファイルごと消す
  const used = new Set([...keeps.values()].flatMap((i) => [i.originalId!, i.editBaseId!]));
  const owners = [...new Set([...currentIds, ...ids])];
  if (owners.length) {
    const { data: sources, error: srcError } = await admin.from("media_files").select("id, storage_path").eq("owner_id", ownerId).in("source_of", owners);
    if (srcError) throw srcError;
    const stale = (sources ?? []).filter((r) => !used.has(r.id) && !ids.includes(r.id));
    if (stale.length) {
      await removeObjects(admin, stale.map((g) => g.storage_path));
      const { error: delError } = await admin.from("media_files").delete().in("id", stale.map((g) => g.id));
      if (delError) throw delError;
    }
  }

  // この投稿から外された画像は、ファイルごと消す（その元の行は DB の cascade で消え、元のファイルは下で消す）
  let removed = admin.from("media_files").select("id, storage_path").eq("owner_id", ownerId).eq("post_id", postId);
  if (ids.length) removed = removed.not("id", "in", `(${ids.join(",")})`);
  const { data: gone, error: goneError } = await removed;
  if (goneError) throw goneError;
  if (gone?.length) {
    const { data: goneSources } = await admin.from("media_files").select("storage_path").eq("owner_id", ownerId).in("source_of", gone.map((g) => g.id));
    await removeObjects(admin, [...gone.map((g) => g.storage_path), ...(goneSources ?? []).map((g) => g.storage_path)]);
    const { error: delError } = await admin.from("media_files").delete().in("id", gone.map((g) => g.id));
    if (delError) throw delError;
  }
}

// この利用者の、AI で作った画像か（縦横を整えて上げ直したときに、AI の印を引き継ぐため）
export async function ownAiMedia(admin: Admin, ownerId: string, mediaId: string): Promise<boolean> {
  const { data } = await admin.from("media_files").select("id").eq("id", mediaId).eq("owner_id", ownerId).eq("ai_generated", true).maybeSingle();
  return Boolean(data);
}

// 保存していない画像を外す（画面の「外す」）。投稿に添えた画像は、投稿を保存したときに attachMedia が消す
export async function discardUnattached(admin: Admin, ownerId: string, id: string): Promise<void> {
  // 保存した投稿の画像の元（source_of のある行）は、ここでは消さない（その画像が外されたときに、投稿の保存で一緒に消える。4.68）
  const { data } = await admin.from("media_files").select("id, storage_path").eq("id", id).eq("owner_id", ownerId).is("post_id", null).is("source_of", null).maybeSingle();
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

// 書きかけの控えから戻せる画像か（4.62）: この投稿の画像か、まだどこにも添えていない（投稿にもメモにも）、上げてから RESTORE_UNATTACHED_HOURS 以内の画像。
// rows は利用者の権限（RLS）で読んだ、本人の行だけ
// 保存した投稿の画像の元（source_of のある行。4.68）は、その画像がこの投稿のもので、同じく読み直すときだけ戻す（古さは問わない）
export function restorableRows<T extends { id: string; post_id: string | null; note_id: string | null; created_at: string; source_of?: string | null }>(rows: T[], postId: string | null, now: Date): T[] {
  const since = now.getTime() - RESTORE_UNATTACHED_HOURS * 3600_000;
  const ofPost = new Set(rows.filter((r) => postId !== null && r.post_id === postId).map((r) => r.id));
  return rows.filter((r) => {
    if (postId !== null && r.post_id === postId) return true;
    if (r.post_id !== null || r.note_id !== null) return false;
    if (r.source_of) return ofPost.has(r.source_of);
    return Date.parse(r.created_at) > since;
  });
}

// 保存していない画像の数（上限の確かめ issue_media_upload_ticket と同じ数え方: どの投稿にもメモにも添えていない画像と、1 日以内の確かめ待ちの引換券。4.63）。
// 画面の「保存していない画像 18/20」に使う。ownerId はサーバーが決めたログイン中の利用者
export async function unattachedCount(admin: Admin, ownerId: string): Promise<number> {
  const [media, tickets] = await Promise.all([
    // 保存した投稿の画像の元（source_of のある行。4.68）は数えない
    admin.from("media_files").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).is("post_id", null).is("note_id", null).is("source_of", null),
    admin.from("media_upload_tickets").select("storage_path", { count: "exact", head: true }).eq("owner_id", ownerId).gt("created_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);
  if (media.error) throw media.error;
  if (tickets.error) throw tickets.error;
  return (media.count ?? 0) + (tickets.count ?? 0);
}

// 書きかけの画像を読み直す（restoreDraftImages の中身。4.62）。db は利用者の権限のクライアント（RLS が本人の行に絞る）。
// sign には、restorableRows で絞ったあとの行のパスだけを渡す（サーバーの権限で URL を作るのは、本人のものと確かめた画像だけ）。控えの順に並べて返す
export async function restoreImages(
  db: SupabaseClient<Database>,
  sign: (paths: string[]) => Promise<Map<string, string>>,
  postId: string | null,
  ids: string[],
  now: Date,
): Promise<{ id: string; previewUrl: string | null; altText: string; width: number; height: number; sizeBytes: number; aiGenerated: boolean }[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from("media_files").select("*").in("id", ids);
  if (error) throw error;
  const rows = restorableRows(data ?? [], postId, now);
  const urls = await sign(rows.map((r) => r.storage_path));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [{ id: r.id, previewUrl: urls.get(r.storage_path) ?? null, altText: r.alt_text, width: r.width, height: r.height, sizeBytes: r.size_bytes, aiGenerated: r.ai_generated }] : [];
  });
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
