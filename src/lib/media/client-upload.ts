import { confirmImageUpload, requestImageUpload } from "./actions";
import { JPEG_QUALITY, MAX_IMAGE_BYTES, MAX_LONG_EDGE, formatBytes } from "./rules";

// ブラウザで画像を JPEG にして上げる（4.18）。投稿の画像とネタ帳のメモの画像で使う

export type UploadedImage = { id: string; previewUrl: string | null; altText: string; width: number; height: number; sizeBytes: number };

// 画像を JPEG に描き直し、長い辺を MAX_LONG_EDGE までに縮める。描き直すので、位置情報などのメタデータは残らない。
// 画像として読めないファイル（拡張子だけ画像のものなど）は、ここで読めずに失敗する
export async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  // JPEG は透明を持てないので、透明なところは白で埋める（画像の中身の色。画面の色ではない）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [JPEG_QUALITY, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
  }
  throw new Error("too_large");
}

export async function uploadImageFile(file: File): Promise<UploadedImage> {
  let blob: Blob;
  try {
    blob = await toJpeg(file);
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message === "too_large"
        ? `「${file.name}」は縮めても ${formatBytes(MAX_IMAGE_BYTES)} を超えます。`
        : `「${file.name}」は画像として読めませんでした。JPEG・PNG・WebP などの画像を選んでください。`,
    );
  }
  return uploadJpeg(blob, `「${file.name}」`);
}

// JPEG を上げて確かめる（選んだ画像も、テンプレートで作った画像も同じ流れ。4.18）
export async function uploadJpeg(blob: Blob, name: string): Promise<UploadedImage> {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error(`${name}は ${formatBytes(MAX_IMAGE_BYTES)} を超えます。`);
  const { ticket, error } = await requestImageUpload();
  if (!ticket) throw new Error(error ?? "画像を追加できませんでした。");
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  if (!res.ok) throw new Error(`${name}を上げられませんでした。時間をおいてもう一度お試しください。`);
  const confirmed = await confirmImageUpload(ticket.path);
  if (!confirmed.image) throw new Error(confirmed.error ?? "画像を確かめられませんでした。");
  const { id, previewUrl, altText, width, height, sizeBytes } = confirmed.image;
  return { id, previewUrl, altText, width, height, sizeBytes };
}
