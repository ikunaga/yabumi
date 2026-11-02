import { INSTAGRAM_MAX_RATIO, INSTAGRAM_MIN_RATIO, instagramRatioOk } from "@/lib/sns";
import { MAX_LONG_EDGE } from "./rules";

// 画像の縦横を整える（Instagram の 4:5〜1.91:1 に収める。docs/architecture.md の 4.18）。
// ここは計算だけで、Canvas には触らない（単体テストできるように）。描くのは aspect-render.ts

export const ASPECT_PRESETS = [
  { key: "4:5", label: "縦 4:5", ratio: 4 / 5 },
  { key: "1:1", label: "正方形 1:1", ratio: 1 },
  { key: "1.91:1", label: "横 1.91:1", ratio: INSTAGRAM_MAX_RATIO },
] as const;
export type AspectKey = (typeof ASPECT_PRESETS)[number]["key"];

export function presetRatio(key: AspectKey): number {
  return ASPECT_PRESETS.find((p) => p.key === key)!.ratio;
}

// 範囲から外れた画像に、いちばん近い枠をすすめる（縦長すぎるなら 4:5、横長すぎるなら 1.91:1、収まっていれば近いもの）
export function suggestAspect(width: number, height: number): AspectKey {
  const r = width / height;
  if (r < INSTAGRAM_MIN_RATIO) return "4:5";
  if (r > INSTAGRAM_MAX_RATIO) return "1.91:1";
  return ASPECT_PRESETS.reduce((best, p) => (Math.abs(Math.log(p.ratio / r)) < Math.abs(Math.log(presetRatio(best) / r)) ? p.key : best), "4:5" as AspectKey);
}

// 縦横比を「9:19.5」「4:5」のように短く書く（画面の印に出す）
export function ratioLabel(width: number, height: number): string {
  const r = width / height;
  const known: [number, string][] = [[4 / 5, "4:5"], [1, "1:1"], [16 / 9, "16:9"], [9 / 16, "9:16"], [3 / 4, "3:4"], [4 / 3, "4:3"], [1.91, "1.91:1"], [2 / 3, "2:3"], [3 / 2, "3:2"]];
  const hit = known.find(([k]) => Math.abs(k - r) < 0.01);
  if (hit) return hit[1];
  return r < 1 ? `1:${(1 / r).toFixed(2).replace(/\.?0+$/, "")}` : `${r.toFixed(2).replace(/\.?0+$/, "")}:1`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type Rect = { sx: number; sy: number; sw: number; sh: number };

// 切り取る: 元の画像の中で、その比率のいちばん大きい枠を取る。pos は余る向きの位置（0 = 左・上、0.5 = 真ん中、1 = 右・下）
export function cropRect(srcW: number, srcH: number, ratio: number, pos = 0.5): Rect {
  const p = clamp(pos, 0, 1);
  if (srcW / srcH > ratio) {
    const sw = Math.round(srcH * ratio);
    return { sx: Math.round((srcW - sw) * p), sy: 0, sw, sh: srcH };
  }
  const sh = Math.round(srcW / ratio);
  return { sx: 0, sy: Math.round((srcH - sh) * p), sw: srcW, sh };
}

// 切り取るときに、位置を動かせる向き（横に余るなら x、縦に余るなら y、ちょうどなら null）
export function cropAxis(srcW: number, srcH: number, ratio: number): "x" | "y" | null {
  const r = srcW / srcH;
  if (Math.abs(r - ratio) < 0.002) return null;
  return r > ratio ? "x" : "y";
}

// できあがりの大きさ。長い辺は 4.18 の上限（MAX_LONG_EDGE）まで。元より大きくはしない
export function outputSize(baseW: number, baseH: number, ratio: number): { w: number; h: number } {
  // 比率どおりの大きさにそろえる（端数で範囲を外れないよう、比率から高さを決め直す）
  let w = baseW;
  let h = Math.round(w / ratio);
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(w / ratio));
  return { w, h };
}

export type PadLayout = { w: number; h: number; dx: number; dy: number; dw: number; dh: number };

// 余白を足す: 切らずに画像をまるごと収め、足りない向きに地を足す
export function padLayout(srcW: number, srcH: number, ratio: number): PadLayout {
  const r = srcW / srcH;
  // 元の画像を縮めずに収められる、その比率の大きさ
  const base = r > ratio ? { w: srcW, h: srcW / ratio } : { w: srcH * ratio, h: srcH };
  const { w, h } = outputSize(Math.round(base.w), Math.round(base.h), ratio);
  const s = Math.min(w / srcW, h / srcH);
  const dw = Math.round(srcW * s);
  const dh = Math.round(srcH * s);
  return { w, h, dx: Math.round((w - dw) / 2), dy: Math.round((h - dh) / 2), dw, dh };
}

// 切り取るときのできあがりの大きさ
export function cropOutput(srcW: number, srcH: number, ratio: number): { w: number; h: number } {
  const r = cropRect(srcW, srcH, ratio);
  return outputSize(r.sw, r.sh, ratio);
}

// ドラッグで動かした量（画面の px）を、位置（0〜1）の変化に直す。shown は画面に出している、できあがりの幅か高さ
export function dragToPos(pos: number, deltaPx: number, srcW: number, srcH: number, ratio: number, shown: number): number {
  const axis = cropAxis(srcW, srcH, ratio);
  if (!axis || shown <= 0) return pos;
  const rect = cropRect(srcW, srcH, ratio, 0);
  // 元の画像の px で、余っている長さ
  const slack = axis === "x" ? srcW - rect.sw : srcH - rect.sh;
  const srcPerScreen = (axis === "x" ? rect.sw : rect.sh) / shown;
  // 指を右へ動かすと、画像も右へ（＝枠は左へ）動く
  return clamp(pos - (deltaPx * srcPerScreen) / slack, 0, 1);
}

// Instagram のカルーセルは、2 枚目からが 1 枚目の比率で切られる（公式: "Carousel images are all cropped based on the first image"）。
// 1 枚目と比率が違う画像の番号（0 始まり）
export function carouselMismatches(sizes: { width: number; height: number }[]): number[] {
  if (sizes.length < 2) return [];
  const first = sizes[0].width / sizes[0].height;
  return sizes.flatMap((s, i) => (i > 0 && Math.abs(s.width / s.height - first) / first > 0.01 ? [i] : []));
}

export { instagramRatioOk };
