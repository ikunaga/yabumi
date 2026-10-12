import { layoutTemplate, type DrawOp, type FontFace, type Layout, type Measure, type TemplateInput } from "./templates";

// テンプレートの画像を Canvas に描く（ブラウザだけで動く。docs/architecture.md の 4.25）

const fontString = (f: FontFace, size: number) => `${f.weight} ${size}px ${f.family}`;

function measurer(ctx: CanvasRenderingContext2D): Measure {
  return (text, font, size) => {
    ctx.font = fontString(font, size);
    return ctx.measureText(text).width;
  };
}

// 描く字の書体を先に読み込む（日本語の書体は字ごとに分かれているので、使う字を渡す）
async function loadFonts(layout: Layout) {
  const want = new Map<string, string>();
  for (const op of layout.ops) {
    if (op.type === "text" || op.type === "placeholder") {
      const key = fontString(op.font, 40);
      want.set(key, (want.get(key) ?? "") + op.text);
    }
  }
  await Promise.all([...want].map(([font, text]) => document.fonts.load(font, text).catch(() => [])));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function drawOp(ctx: CanvasRenderingContext2D, op: DrawOp, shot: ImageBitmap | null) {
  switch (op.type) {
    case "rect":
      ctx.fillStyle = op.fill;
      roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.fill();
      return;
    case "circle":
      ctx.fillStyle = op.fill;
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "tri":
      ctx.fillStyle = op.fill;
      ctx.beginPath();
      op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      return;
    case "text":
      ctx.font = fontString(op.font, op.size);
      ctx.fillStyle = op.color;
      ctx.textAlign = op.align;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(op.text, op.x, op.y);
      return;
    case "image": {
      if (!shot) return;
      ctx.save();
      roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.clip();
      // 枠いっぱいに、上をそろえて切り取る（スマホの画面は上が大事）
      const scale = Math.max(op.w / shot.width, op.h / shot.height);
      const sw = op.w / scale;
      const sh = op.h / scale;
      ctx.drawImage(shot, (shot.width - sw) / 2, 0, sw, sh, op.x, op.y, op.w, op.h);
      ctx.restore();
      return;
    }
    case "placeholder":
      ctx.save();
      roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
      ctx.setLineDash([op.size * 0.4, op.size * 0.3]);
      ctx.lineWidth = Math.max(2, op.size * 0.08);
      ctx.strokeStyle = op.stroke;
      ctx.stroke();
      ctx.restore();
      ctx.font = fontString(op.font, op.size);
      ctx.fillStyle = op.color;
      ctx.textAlign = "center";
      ctx.fillText(op.text, op.x + op.w / 2, op.y + Math.min(op.h / 2, op.size * 4));
      return;
  }
}

// 書体を読み込んでから、決めた大きさの Canvas に描く。書体の読み込みで字の幅が変わるので、読み込んだあとにもう一度並べ直す
export async function renderTemplate(canvas: HTMLCanvasElement, input: TemplateInput, shot: ImageBitmap | null): Promise<Layout> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  await loadFonts(layoutTemplate(input, measurer(ctx)));
  const layout = layoutTemplate(input, measurer(ctx));
  canvas.width = layout.w;
  canvas.height = layout.h;
  for (const op of layout.ops) drawOp(ctx, op, shot);
  return layout;
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", quality));
}
