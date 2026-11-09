import { adjustLayout, applyTone, type Adjustments } from "./adjust";

// 調整した画像を Canvas に描く（ブラウザーだけで動く。adjust.ts の計算を使う）。
// できた Canvas は template-render.ts の canvasToJpeg で JPEG にして、4.18 の流れで上げる（縦横を整えると同じ）。
// maxW を渡すと見本として小さく描く（スライダーを動かすたびに描くので、色の計算も小さい絵の分だけで済む）
export function renderAdjust(canvas: HTMLCanvasElement, src: ImageBitmap, a: Adjustments, maxW?: number): void {
  const l = adjustLayout(src.width, src.height, a);
  const fit = maxW ? Math.min(1, maxW / l.out.w) : 1;
  canvas.width = Math.max(1, Math.round(l.out.w * fit));
  canvas.height = Math.max(1, Math.round(l.out.h * fit));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  // 残す範囲（回転したあとの枠の px）を、できあがりの大きさに合わせる
  const k = canvas.width / l.crop.sw;
  ctx.setTransform(k, 0, 0, k, -l.crop.sx * k, -l.crop.sy * k);
  // 枠の真ん中で回して、まっすぐにした分だけ大きくする
  ctx.translate(l.frame.w / 2, l.frame.h / 2);
  ctx.rotate(l.angle);
  ctx.scale(l.scale, l.scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyTone(img.data, a.tone);
  ctx.putImageData(img, 0, 0);
}

// 「おまかせで整える」の材料: 見本の画素
export function readPixels(canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height).data : null;
}
