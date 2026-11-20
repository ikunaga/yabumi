import "server-only";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { layoutTemplate, type DrawOp, type FontFace, type Layout, type Measure, type TemplateInput } from "./templates";
import { registerServerFonts } from "./server-fonts";

// テンプレートの画像をサーバーで描く（docs/design/auto-sample-image.md の 11.。段取り ④）。画面の template-render.ts と同じ並べ方（layoutTemplate）と
// 同じ描き方（DrawOp）を、@napi-rs/canvas（Skia）で描く。字の幅は Skia で測るので、画面の Canvas と 1 字ほど折り返しがずれることがある

const fontString = (f: FontFace, size: number) => `${f.weight} ${size}px ${f.family}`;

function measurer(ctx: SKRSContext2D): Measure {
  return (text, font, size) => {
    ctx.font = fontString(font, size);
    return ctx.measureText(text).width;
  };
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function drawOp(ctx: SKRSContext2D, op: DrawOp, shot: Image | null) {
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
      const scale = Math.max(op.w / shot.width, op.h / shot.height);
      const sw = op.w / scale;
      const sh = op.h / scale;
      ctx.drawImage(shot, (shot.width - sw) / 2, op.fit === "center" ? (shot.height - sh) / 2 : 0, sw, sh, op.x, op.y, op.w, op.h);
      ctx.restore();
      return;
    }
    case "shade": {
      const g = ctx.createLinearGradient(0, op.y, 0, op.y + op.h);
      g.addColorStop(0, op.from);
      g.addColorStop(1, op.to);
      ctx.fillStyle = g;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      return;
    }
    case "placeholder":
      // サーバーでは写真のない枠を描かない（自動の回はいつも写真を敷く）
      return;
  }
}

// 並べてから描き、JPEG（画質 90。画面の canvasToJpeg と同じ）にする。photo は敷く写真（JPEG・PNG のバイト列）
export async function renderTemplateJpeg(input: TemplateInput, photo: Uint8Array | null): Promise<{ bytes: Uint8Array; layout: Layout }> {
  registerServerFonts();
  const shot = photo ? await loadImage(Buffer.from(photo)) : null;
  const measureCanvas = createCanvas(16, 16);
  const layout = layoutTemplate(input, measurer(measureCanvas.getContext("2d")));
  const canvas = createCanvas(layout.w, layout.h);
  const ctx = canvas.getContext("2d");
  for (const op of layout.ops) drawOp(ctx, op, shot);
  const bytes = await canvas.encode("jpeg", 90);
  return { bytes: new Uint8Array(bytes), layout };
}
