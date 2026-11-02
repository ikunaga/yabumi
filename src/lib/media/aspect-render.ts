import { cropOutput, cropRect, padLayout, phoneFrameLayout, type PhoneOrientation } from "./aspect";

// 縦横を整えた画像を Canvas に描く（ブラウザだけで動く。aspect.ts の計算を使う）。
// できた Canvas は template-render.ts の canvasToJpeg で JPEG にして、4.18 の流れで上げる

export type PadFill = { kind: "blur" } | { kind: "color"; color: string };

// 地を塗る（色、またはぼかした同じ画像）
function fillGround(ctx: CanvasRenderingContext2D, src: ImageBitmap, W: number, H: number, fill: PadFill): void {
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
}

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
  fillGround(ctx, src, canvas.width, canvas.height, fill);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, l.dx * scale, l.dy * scale, l.dw * scale, l.dh * scale);
}

export type PhoneFrameColor = "black" | "white";
// 縁の色と、地の色に紛れないよう外側に置く細い輪の色（画像の中身の色。画面の色ではない）。黒はテンプレートの枠と同じ
const FRAME_COLORS: Record<PhoneFrameColor, { bezel: string; ring: string }> = {
  black: { bezel: "#0e0e10", ring: "rgba(255,255,255,0.22)" },
  white: { bezel: "#f4f4f2", ring: "rgba(0,0,0,0.14)" },
};

// スマホの枠に入れる: 地を塗り、真ん中に枠を置いて、画面の中に画像を描く
export function renderPhoneFrame(
  canvas: HTMLCanvasElement,
  src: ImageBitmap,
  ratio: number,
  opts: { orientation: PhoneOrientation; frame: PhoneFrameColor; fill: PadFill },
  maxW?: number,
): void {
  const l = phoneFrameLayout(src.width, src.height, ratio, opts.orientation);
  const scale = maxW ? Math.min(1, maxW / l.w) : 1;
  canvas.width = Math.max(1, Math.round(l.w * scale));
  canvas.height = Math.max(1, Math.round(l.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  fillGround(ctx, src, canvas.width, canvas.height, opts.fill);
  // ここから先は、できあがりの大きさの座標で描く
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const color = FRAME_COLORS[opts.frame];
  for (const [box, fillStyle] of [
    [l.ring, color.ring],
    [l.bezel, color.bezel],
  ] as const) {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, box.r);
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(l.screen.x, l.screen.y, l.screen.w, l.screen.h, l.screen.r);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, l.crop.sx, l.crop.sy, l.crop.sw, l.crop.sh, l.screen.x, l.screen.y, l.screen.w, l.screen.h);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
