import { cropOutput, cropRect, padLayout } from "./aspect";

// 縦横を整えた画像を Canvas に描く（ブラウザだけで動く。aspect.ts の計算を使う）。
// できた Canvas は template-render.ts の canvasToJpeg で JPEG にして、4.18 の流れで上げる

export type PadFill = { kind: "blur" } | { kind: "color"; color: string };

export function renderCrop(canvas: HTMLCanvasElement, src: ImageBitmap, ratio: number, pos: number, maxW?: number): void {
  const out = cropOutput(src.width, src.height, ratio);
  const scale = maxW ? Math.min(1, maxW / out.w) : 1;
  canvas.width = Math.max(1, Math.round(out.w * scale));
  canvas.height = Math.max(1, Math.round(out.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const r = cropRect(src.width, src.height, ratio, pos);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
}

export function renderPad(canvas: HTMLCanvasElement, src: ImageBitmap, ratio: number, fill: PadFill, maxW?: number): void {
  const l = padLayout(src.width, src.height, ratio);
  const scale = maxW ? Math.min(1, maxW / l.w) : 1;
  canvas.width = Math.max(1, Math.round(l.w * scale));
  canvas.height = Math.max(1, Math.round(l.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const W = canvas.width;
  const H = canvas.height;
  if (fill.kind === "color") {
    ctx.fillStyle = fill.color;
    ctx.fillRect(0, 0, W, H);
  } else {
    // ぼかした同じ画像: いったん小さく描いてから大きく引き伸ばす（ctx.filter の blur は Safari の古い版で効かないため、この方法にする）
    const tiny = document.createElement("canvas");
    const s = 24 / Math.max(src.width, src.height);
    tiny.width = Math.max(1, Math.round(src.width * s));
    tiny.height = Math.max(1, Math.round(src.height * s));
    tiny.getContext("2d")?.drawImage(src, 0, 0, tiny.width, tiny.height);
    const cover = Math.max(W / tiny.width, H / tiny.height);
    const tw = tiny.width * cover;
    const th = tiny.height * cover;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tiny, (W - tw) / 2, (H - th) / 2, tw, th);
    // 地が目立ちすぎないよう、少し暗くする（画像の中身の色。画面の色ではない）
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, l.dx * scale, l.dy * scale, l.dw * scale, l.dh * scale);
}
