// 整えた動画を上げて確かめる（docs/design/video.md の 3.）。画面（client）からだけ使う。
// サーバーが発行した署名つきのトークンで、TUS（6MB ずつ。途中で切れても同じ画面の中なら続きから）で Storage に直接上げる。
// tus-js-client は、動画を上げるときに読み込む（import() で分ける）。
// やめたとき（signal）は、上げている途中でも、上げ終えたあと・確かめたあとでも、サーバーで引換券とファイルを片付ける
// （cancelVideo。前は上げ終えたあとにやめると引換券とファイルが残り、1 日動画を追加できなくなった。2026-11-15 PMO の確かめ v15）。
// やめたあとに最後の送信が届いてファイルができても、次の上限の確かめ・やめるでサーバーが消す（purgeOrphanVideos）ので、画面は待たない

import { browserClient } from "@/lib/supabase/browser";
import { cancelVideo, confirmVideoUpload, discardVideo, requestVideoUpload, type UploadedVideo } from "./video-actions";

// Supabase の資料で決まっている大きさ（変えない）
const TUS_CHUNK = 6 * 1024 * 1024;

export class VideoUploadError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "VideoUploadError";
  }
}

const aborted = () => new DOMException("やめました", "AbortError");

// onUploaded: 上げ終えて、サーバーの確かめに入るとき（画面は「やめる」を隠す）
export async function uploadVideoBlob(
  blob: Blob,
  opts: { onProgress?: (ratio: number) => void; onUploaded?: () => void; signal?: AbortSignal } = {},
): Promise<UploadedVideo> {
  if (opts.signal?.aborted) throw aborted();
  const { ticket, error } = await requestVideoUpload();
  if (!ticket) throw new VideoUploadError(error ?? "動画を追加できませんでした。");
  // ここから先でやめたら、引換券とファイルを片付ける
  const cleanup = () => void cancelVideo(ticket.path);
  if (opts.signal?.aborted) {
    cleanup();
    throw aborted();
  }
  const { Upload } = await import("tus-js-client");
  // 利用者のログインのまま上げる（Storage の insert のポリシーが、引換券のある場所だけを通す）。
  // アクセストークンは送るたびに読み直す（getSession は期限の 90 秒前を切ると取り直す。最初に 1 回読んだだけだと、
  // 期限の近いトークンで上げ始めたときに、途中で切れて残りが断られる）
  const accessToken = async () => (await browserClient().auth.getSession()).data.session?.access_token ?? null;
  if (!(await accessToken())) {
    cleanup();
    throw new VideoUploadError("ログインし直してください。");
  }
  // やめたか（やめたあとに届いた onSuccess は、もう一度片付ける）
  let stopped = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(blob, {
        endpoint: ticket.endpoint,
        chunkSize: TUS_CHUNK,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        // 同じファイルを続きから上げるための記録は、ブラウザに残さない（トークンは 2 時間で切れ、置き場所も毎回違う）
        storeFingerprintForResuming: false,
        removeFingerprintOnSuccess: true,
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          "x-upsert": "false",
        },
        onBeforeRequest: async (req) => {
          const token = await accessToken();
          if (token) req.setHeader("Authorization", `Bearer ${token}`);
        },
        metadata: { bucketName: ticket.bucket, objectName: ticket.path, contentType: "video/mp4", cacheControl: "3600" },
        onProgress: (sent, total) => opts.onProgress?.(total > 0 ? sent / total : 0),
        onSuccess: () => {
          // やめたあとに最後の送信が終わってファイルができた: もう一度片付ける（2026-11-15 PMO の再確認。引換券の印で書き込みは断られる見込みだが、
          // 印を付ける前に最後の送信が届いていた場合に備える）
          if (stopped) return cleanup();
          resolve();
        },
        onError: (e) => {
          console.error("[video] 上げられませんでした", e.message);
          reject(new VideoUploadError("動画を上げられませんでした。通信のよいところで、もう一度お試しください。"));
        },
      });
      const abort = () => {
        stopped = true;
        // 送信を止める（終わりは待たない。DELETE のやり直しで 20 秒ほどかかることがある）。上げ終えたあとの abort は
        // 「Cannot terminate an already completed upload」で断られるので、失敗は拾って捨てる。片付けはサーバーで行う
        upload.abort(true).catch(() => {});
        reject(aborted());
      };
      if (opts.signal?.aborted) return abort();
      opts.signal?.addEventListener("abort", abort, { once: true });
      upload.start();
    });
  } catch (e) {
    cleanup();
    throw e;
  }
  if (opts.signal?.aborted) {
    cleanup();
    throw aborted();
  }
  opts.onUploaded?.();
  const confirmed = await confirmVideoUpload(ticket.path);
  if (!confirmed.video) throw new VideoUploadError(confirmed.error ?? "動画を確認できませんでした。もう一度選び直してください。");
  // 確かめている間にやめていたら、添えずに外す（前は、やめたのに添えられたままになることがあった）
  if (opts.signal?.aborted) {
    void discardVideo(confirmed.video.id);
    cleanup();
    throw aborted();
  }
  return confirmed.video;
}
