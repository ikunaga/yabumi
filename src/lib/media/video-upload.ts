// 整えた動画を上げて確かめる（docs/design/video.md の 3.）。画面（client）からだけ使う。
// サーバーが発行した署名つきのトークンで、TUS（6MB ずつ。途中で切れても同じ画面の中なら続きから）で Storage に直接上げる。
// tus-js-client は、動画を上げるときに読み込む（import() で分ける）

import { confirmVideoUpload, requestVideoUpload, type UploadedVideo } from "./video-actions";

// Supabase の資料で決まっている大きさ（変えない）
const TUS_CHUNK = 6 * 1024 * 1024;

export class VideoUploadError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "VideoUploadError";
  }
}

export async function uploadVideoBlob(blob: Blob, opts: { onProgress?: (ratio: number) => void; signal?: AbortSignal } = {}): Promise<UploadedVideo> {
  const { ticket, error } = await requestVideoUpload();
  if (!ticket) throw new VideoUploadError(error ?? "動画を追加できませんでした。");
  const { Upload } = await import("tus-js-client");
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
        "x-signature": ticket.token,
        "x-upsert": "false",
      },
      metadata: { bucketName: ticket.bucket, objectName: ticket.path, contentType: "video/mp4", cacheControl: "3600" },
      onProgress: (sent, total) => opts.onProgress?.(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
      onError: (e) => {
        console.error("[video] 上げられませんでした", e.message);
        reject(new VideoUploadError("動画を上げられませんでした。通信のよいところで、もう一度お試しください。"));
      },
    });
    const abort = () => {
      void upload.abort(true);
      reject(new DOMException("やめました", "AbortError"));
    };
    if (opts.signal?.aborted) return abort();
    opts.signal?.addEventListener("abort", abort, { once: true });
    upload.start();
  });
  const confirmed = await confirmVideoUpload(ticket.path);
  if (!confirmed.video) throw new VideoUploadError(confirmed.error ?? "動画を確かめられませんでした。もう一度選び直してください。");
  return confirmed.video;
}
