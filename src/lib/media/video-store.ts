import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { checkMp4, Mp4CheckError, mp4ProblemMessage } from "./mp4-check";
import { MediaError } from "./store";
import { SNS_FETCH_URL_SECONDS, formatBytes } from "./rules";
import {
  KEEP_VIDEO_AFTER_SENT_DAYS,
  MAX_PENDING_VIDEO_TICKETS,
  MAX_UNATTACHED_VIDEOS,
  MAX_VIDEO_BYTES,
  VIDEO_BUCKET,
  VIDEO_GLOBAL_QUOTA_BYTES,
  VIDEO_MONTH_LIMIT,
  VIDEO_READ_URL_SECONDS,
  VIDEO_USER_QUOTA_BYTES,
  isOwnVideoPath,
  videoPath,
} from "./video-rules";

// 投稿に添える動画の、上げる・確かめる・添える・読む（docs/design/video.md の 3.・5.・7.）。admin は RLS を通らないクライアント。
// 呼ぶ側で、ownerId がログイン中の利用者であることを確かめておく

type Admin = SupabaseClient<Database>;

export type VideoFile = { id: string; storagePath: string; durationMs: number; width: number; height: number; sizeBytes: number };

// 送信ジョブが使う形（実装担当2 の YouTube と 2026-11-15 に合わせた）
export type PostVideo = {
  mediaId: string;
  // サーバーが確かめたときの大きさ
  sizeBytes: number;
  mime: "video/mp4";
  durationMs: number;
  // 回転を当てたあとの見た目の縦横
  width: number;
  height: number;
  // いまは常に false（動画を AI で作る機能はない）
  aiGenerated: boolean;
  // [start, endExclusive) を読む。範囲の外は RangeError（送信ジョブでは permanent）、通信などはふつうの Error（retryable）
  readRange(start: number, endExclusive: number): Promise<Uint8Array>;
};

type Row = Database["public"]["Tables"]["media_files"]["Row"];

function toVideoFile(r: Pick<Row, "id" | "storage_path" | "duration_ms" | "width" | "height" | "size_bytes">): VideoFile {
  return { id: r.id, storagePath: r.storage_path, durationMs: r.duration_ms ?? 0, width: r.width, height: r.height, sizeBytes: r.size_bytes };
}

async function removeVideoObjects(admin: Admin, paths: string[]) {
  if (!paths.length) return;
  const { error } = await admin.storage.from(VIDEO_BUCKET).remove(paths);
  if (error) console.error("[video] 動画を消せませんでした", error.message);
}

export type VideoUploadTicket = { path: string };

const LIMITS = {
  p_max_pending: MAX_PENDING_VIDEO_TICKETS,
  p_max_unattached: MAX_UNATTACHED_VIDEOS,
  p_quota_bytes: VIDEO_USER_QUOTA_BYTES,
  p_max_file_bytes: MAX_VIDEO_BYTES,
  p_month_limit: VIDEO_MONTH_LIMIT,
  p_global_quota_bytes: VIDEO_GLOBAL_QUOTA_BYTES,
};

// 上限に当たったときの文。添えていない動画は、実際の本数を出す
async function limitMessage(admin: Admin, ownerId: string, status: string): Promise<string | null> {
  if (status === "ok") return null;
  if (status === "too_many_pending") return "動画の追加が続いています。少し待ってからもう一度お試しください。";
  if (status === "too_many_unattached") {
    const { count } = await admin.from("media_files").select("id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("kind", "video").is("post_id", null);
    return `保存していない動画が ${count ?? MAX_UNATTACHED_VIDEOS} 本あります。要らない動画を外すか、投稿を保存してから追加してください。`;
  }
  if (status === "quota") {
    return `置ける動画の合計（${formatBytes(VIDEO_USER_QUOTA_BYTES)}）に近づいています。送り終えた動画は ${KEEP_VIDEO_AFTER_SENT_DAYS} 日で消えます。要らない下書きの動画を外してください。`;
  }
  if (status === "month_limit") return `動画は 1 か月に ${VIDEO_MONTH_LIMIT} 本まで追加できます。来月 1 日からまた追加できます。`;
  if (status === "global_quota") {
    console.error("[video] 全体の動画の量が上限に達しました");
    return "いま動画を受け付けられません。時間をおいてもう一度お試しください。";
  }
  throw new Error(`上限を確かめられませんでした（${status}）`);
}

// 本人の「使った印つき・記録のない引換券の場所」に残っているファイルを消す（docs/design/video.md の 11.）。
// Storage の insert のポリシーが効くのは TUS を作るとき（POST）で、作ったあとの 1 本は、やめて印を付けたあとでも最後の書き込みが届いて
// ファイルができることがある（2026-11-15 PMO の再確認: 6 回中 4 回、印の 0.1〜0.4 秒後）。時刻の競り合いに頼らず、上限を数える前と
// やめるたびに、ここで消す（ないファイルを消しても何も起きない）。消すのは本人の引換券の場所だけ
export async function purgeOrphanVideos(admin: Admin, ownerId: string): Promise<void> {
  const { data: tickets, error } = await admin
    .from("media_upload_tickets")
    .select("storage_path")
    .eq("owner_id", ownerId)
    .eq("kind", "video")
    .not("consumed_at", "is", null);
  if (error) throw error;
  const paths = (tickets ?? []).map((t) => t.storage_path).filter((p) => isOwnVideoPath(ownerId, p));
  if (!paths.length) return;
  const { data: recorded } = await admin.from("media_files").select("storage_path").in("storage_path", paths);
  const keep = new Set((recorded ?? []).map((r) => r.storage_path));
  const orphans = paths.filter((p) => !keep.has(p));
  if (orphans.length) await removeVideoObjects(admin, orphans);
}

// 上限の確かめだけ（読むだけ。整える前に画面が呼ぶ。docs/design/video.md の 7.）。当たっていれば MediaError。
// 本当の守りは引換券の発行（issueVideoUpload。ロックの中で同じ確かめをする）
export async function checkVideoUpload(admin: Admin, ownerId: string): Promise<void> {
  await purgeOrphanVideos(admin, ownerId);
  const { data: status, error } = await admin.rpc("video_upload_check", { p_owner_id: ownerId, ...LIMITS });
  if (error) throw error;
  const message = await limitMessage(admin, ownerId, status);
  if (message) throw new MediaError(message);
}

// 動画を 1 本上げるための引換券を発行する。ブラウザは利用者のログインのまま、TUS でこの場所に上げる（画像の issueUpload と同じ。
// Storage の insert のポリシーが、本人の・まだ使っていない・2 時間以内の引換券がある場所だけを通す）。
// 上限の確認と引換券の記録は DB の中で、利用者ごと・全体のロックの中で行う
export async function issueVideoUpload(admin: Admin, ownerId: string, id: string = crypto.randomUUID()): Promise<VideoUploadTicket> {
  const path = videoPath(ownerId, id);
  await purgeOrphanVideos(admin, ownerId);
  const { data: status, error: ticketError } = await admin.rpc("issue_video_upload_ticket", { p_owner_id: ownerId, p_storage_path: path, ...LIMITS });
  if (ticketError) throw ticketError;
  const message = await limitMessage(admin, ownerId, status);
  if (message) throw new MediaError(message);
  return { path };
}

// 上げている途中・確かめる前後に「やめる」を押したとき（docs/design/video.md の 3.）。本人の動画の引換券に使った印を付け
// （もう確かめない。Storage のポリシーで、その場所に新しく TUS を作れなくなる）、その場所のファイルを消す。
// すでに作ってある TUS の最後の書き込みは、印のあとに届いてファイルができることがある。それは次の上限の確かめ・やめるで消える（purgeOrphanVideos）。確かめを通ってまだ投稿に添えていなければ、その動画も外す。
// 月の本数は確かめを通った動画だけを数えるので、確かめる前にやめれば数えない
export async function cancelVideoUpload(admin: Admin, ownerId: string, path: string): Promise<void> {
  if (!isOwnVideoPath(ownerId, path)) return;
  const { data: ticket } = await admin.from("media_upload_tickets").select("storage_path, consumed_at").eq("storage_path", path).eq("owner_id", ownerId).eq("kind", "video").maybeSingle();
  if (!ticket) return;
  if (!ticket.consumed_at) await admin.from("media_upload_tickets").update({ consumed_at: new Date().toISOString() }).eq("storage_path", path);
  const { data: row } = await admin.from("media_files").select("id, post_id").eq("storage_path", path).eq("owner_id", ownerId).maybeSingle();
  if (row && row.post_id !== null) return;
  await removeVideoObjects(admin, [path]);
  if (row) await admin.from("media_files").delete().eq("id", row.id);
  await purgeOrphanVideos(admin, ownerId);
}

// ブラウザが上げた動画を確かめて記録する。MP4 の箱を読み（作り直さない）、合わなければファイルを消し、引換券に使った印を付けて MediaError
export async function verifyVideoUpload(admin: Admin, ownerId: string, path: string): Promise<VideoFile> {
  if (!isOwnVideoPath(ownerId, path)) throw new MediaError("動画の置き場所が正しくありません。もう一度選び直してください。");

  const { data: existing } = await admin.from("media_files").select("*").eq("storage_path", path).maybeSingle();
  if (existing) {
    if (existing.owner_id !== ownerId || existing.kind !== "video") throw new MediaError("動画の置き場所が正しくありません。");
    return toVideoFile(existing);
  }

  // 引換券は使ったら消さずに印を付ける（consumed_at）。署名つきのトークンは 2 時間使えるので、断った・外した場所に上げ直されたファイルを、
  // DB が量の上限に数え、片付けがすぐ消せるようにするため（20261115100000 の media_upload_tickets.consumed_at）
  const consume = () => admin.from("media_upload_tickets").update({ consumed_at: new Date().toISOString() }).eq("storage_path", path);
  const { data: ticket } = await admin
    .from("media_upload_tickets")
    .select("storage_path")
    .eq("storage_path", path)
    .eq("owner_id", ownerId)
    .eq("kind", "video")
    .is("consumed_at", null)
    .maybeSingle();
  if (!ticket) throw new MediaError("動画の置き場所が正しくありません。もう一度選び直してください。");

  try {
    const { data: blob, error } = await admin.storage.from(VIDEO_BUCKET).download(path);
    if (error || !blob) throw new MediaError("動画を読めませんでした。もう一度選び直してください。");
    if (blob.size > MAX_VIDEO_BYTES) throw new MediaError(`動画が大きすぎます（${formatBytes(blob.size)}）。${formatBytes(MAX_VIDEO_BYTES)} までです。`);
    let info;
    try {
      info = checkMp4(new Uint8Array(await blob.arrayBuffer()));
    } catch (e) {
      if (e instanceof Mp4CheckError) {
        console.error("[video] 確かめで受け付けませんでした", e.problem);
        throw new MediaError(mp4ProblemMessage(e.problem));
      }
      throw e;
    }
    const { data: row, error: insError } = await admin
      .from("media_files")
      .insert({ owner_id: ownerId, storage_path: path, kind: "video", duration_ms: info.durationMs, width: info.width, height: info.height, size_bytes: blob.size })
      .select("*")
      .single();
    if (insError) throw insError;
    // 順番を変えない: 記録してから印を付ける。purgeOrphanVideos は「印つき・記録なし」の場所だけを消すので、
    // 印の前（確かめている間）も、印のあと（記録あり）も、確かめた動画は消されない（2026-11-15 PM の確かめ）
    await consume();
    return toVideoFile(row);
  } catch (e) {
    await removeVideoObjects(admin, [path]);
    await consume();
    throw e;
  }
}

// 投稿の動画をそろえる（投稿の保存で、画像の attachMedia のあとに呼ぶ）。videoId が null なら外す。
// 外した・入れ替えた動画は、ファイルごと消す。画像が添えてある投稿には添えない（DB のトリガーでも断る）
// keepRemoved: 外すだけのとき、送り終えて消した動画の印（removed_at のある行）を残すか（既定は残す。画像を添えるときは外す）
export async function attachVideo(admin: Admin, ownerId: string, postId: string, videoId: string | null, { keepRemoved = true }: { keepRemoved?: boolean } = {}): Promise<void> {
  const { data: post } = await admin.from("posts").select("id").eq("id", postId).eq("owner_id", ownerId).maybeSingle();
  if (!post) throw new MediaError("投稿が見つかりません。");

  if (videoId) {
    const { data: row } = await admin.from("media_files").select("id, post_id, removed_at").eq("id", videoId).eq("owner_id", ownerId).eq("kind", "video").maybeSingle();
    if (!row || row.removed_at || (row.post_id !== null && row.post_id !== postId)) throw new MediaError("見つからない動画があります。画面を読み込み直してください。");
    const { count } = await admin.from("media_files").select("id", { count: "exact", head: true }).eq("post_id", postId).eq("kind", "image");
    if ((count ?? 0) > 0) throw new MediaError("画像と動画は一緒に添えられません。どちらかを外してください。");
  }

  // 入れ替え・外すときは、先に前の動画を消す（1 つの投稿に動画は 1 本の一意の索引）。
  // 外すだけ（videoId が null）のときは、送り終えて消した動画の印（removed_at のある行）は残す（送り直すときに、文だけで送ってしまわないように）
  let old = admin.from("media_files").select("id, storage_path").eq("owner_id", ownerId).eq("post_id", postId).eq("kind", "video");
  if (videoId) old = old.neq("id", videoId);
  else if (keepRemoved) old = old.is("removed_at", null);
  const { data: gone, error: goneError } = await old;
  if (goneError) throw goneError;
  if (gone?.length) {
    await removeVideoObjects(admin, gone.map((g) => g.storage_path));
    const { error } = await admin.from("media_files").delete().in("id", gone.map((g) => g.id));
    if (error) throw error;
  }

  if (videoId) {
    const { error } = await admin.from("media_files").update({ post_id: postId, position: 0 }).eq("id", videoId).eq("owner_id", ownerId);
    if (error) {
      if (error.code === "23514") throw new MediaError("画像と動画は一緒に添えられません。どちらかを外してください。");
      throw error;
    }
  }
}

// 保存していない動画を外す（画面の「外す」）。投稿に添えた動画は、投稿を保存したときに attachVideo が消す
export async function discardUnattachedVideo(admin: Admin, ownerId: string, id: string): Promise<void> {
  const { data } = await admin.from("media_files").select("id, storage_path").eq("id", id).eq("owner_id", ownerId).eq("kind", "video").is("post_id", null).maybeSingle();
  if (!data) return;
  await removeVideoObjects(admin, [data.storage_path]);
  await admin.from("media_files").delete().eq("id", data.id);
}

// 期限つきの URL（画面のプレビュー・SNS が取りに来るとき）
export async function signedVideoUrl(db: SupabaseClient<Database>, path: string, seconds: number): Promise<string> {
  const { data, error } = await db.storage.from(VIDEO_BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw error ?? new Error("動画の URL を作れませんでした");
  return data.signedUrl;
}

// 投稿に添えた動画の行（消したあとのものも。画面で「消しました」を出すため）。db は利用者の権限でも、サーバーの権限でもよい
export async function postVideoRow(db: SupabaseClient<Database>, postId: string): Promise<(VideoFile & { removedAt: string | null }) | null> {
  const { data, error } = await db.from("media_files").select("*").eq("post_id", postId).eq("kind", "video").maybeSingle();
  if (error) throw error;
  return data ? { ...toVideoFile(data), removedAt: data.removed_at } : null;
}

type Fetch = typeof fetch;

// 送信ジョブが動画を読む（docs/design/video.md の 5.）。添えていない・消したあと・ファイルがないときは null。
// readRange: 最初の呼び出しで 5 分の署名 URL を 1 回作って使い回し、Range で読む。Range が効かず全体が返ったら、
// その中身を持っておき、2 回目からは読み直さない（1 回の関数の中で 50MB を何度も読まない）
export async function postVideoFor(admin: Admin, postId: string, deps: { fetch?: Fetch; now?: () => number } = {}): Promise<PostVideo | null> {
  const row = await postVideoRow(admin, postId);
  if (!row || row.removedAt) return null;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  // 署名 URL を先に 1 回作る（ファイルがなければここで null）
  const first = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(row.storagePath, VIDEO_READ_URL_SECONDS);
  if (first.error || !first.data) {
    if (/not.?found/i.test(first.error?.message ?? "")) return null;
    throw first.error ?? new Error("動画の URL を作れませんでした");
  }
  let url: { value: string; until: number } = { value: first.data.signedUrl, until: now() + VIDEO_READ_URL_SECONDS * 1000 };
  let whole: Uint8Array | null = null;
  const size = row.sizeBytes;

  const signed = async () => {
    // 期限の 30 秒前には作り直す
    if (url.until - 30_000 < now()) {
      url = { value: await signedVideoUrl(admin, row.storagePath, VIDEO_READ_URL_SECONDS), until: now() + VIDEO_READ_URL_SECONDS * 1000 };
    }
    return url.value;
  };

  return {
    mediaId: row.id,
    sizeBytes: size,
    mime: "video/mp4",
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    aiGenerated: false,
    async readRange(start, endExclusive) {
      if (!Number.isInteger(start) || !Number.isInteger(endExclusive) || start < 0 || endExclusive > size || start >= endExclusive) {
        throw new RangeError(`動画の範囲が正しくありません（${start}〜${endExclusive}、大きさ ${size}）`);
      }
      if (whole) return whole.slice(start, endExclusive);
      const res = await doFetch(await signed(), { headers: { Range: `bytes=${start}-${endExclusive - 1}` } });
      if (res.status === 206) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length !== endExclusive - start) throw new Error(`動画を読めませんでした（${bytes.length} バイトしか返りませんでした）`);
        return bytes;
      }
      if (res.status === 200) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length !== size) throw new Error(`動画を読めませんでした（大きさが ${bytes.length} で、記録の ${size} と合いません）`);
        whole = bytes;
        return whole.slice(start, endExclusive);
      }
      throw new Error(`動画を読めませんでした（${res.status}）`);
    },
  };
}

// 送信ジョブが SNS に渡す動画（postVideoFor に、SNS が取りに来るための 1 時間の署名 URL を足したもの）。
// 動画を添えていなければ null。添えていたが消したあと（送り終えて片付けた・ファイルがない）は "removed"（文だけで送ってしまわないように）
export async function publishVideoFor(admin: Admin, postId: string): Promise<(PostVideo & { url: string }) | "removed" | null> {
  const row = await postVideoRow(admin, postId);
  if (!row) return null;
  if (row.removedAt) return "removed";
  const video = await postVideoFor(admin, postId);
  if (!video) return "removed";
  return { ...video, url: await signedVideoUrl(admin, row.storagePath, SNS_FETCH_URL_SECONDS) };
}
