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

// ── スマホの枠に入れる（アプリの画面のスクリーンショットなど）──
// 描き方はテンプレートの「写真に見出し」の端末の枠（templates.ts の layoutScreen）に合わせる: 角丸の縁と、外側の細い輪。
// 実在の機種の形（ノッチ・ボタン・ロゴ）は写さない

export type PhoneOrientation = "portrait" | "landscape";

// 画面の縦横の範囲。縦向きは 9:21〜9:16（スマホの画面に見える範囲。3:4 まで広げるとタブレットに見える）、横向きはその逆。外れた画像は画面に合わせて切る
export const PHONE_SCREEN_RANGE = { min: 9 / 21, max: 9 / 16 } as const;
// 縁と輪の太さ・画面の角の丸み（画面の短い辺に対する割合。テンプレートの枠と同じ見た目になる値）
const PHONE_BEZEL = 0.022;
const PHONE_RING = 0.0045;
const PHONE_RADIUS = 0.085;
// まわりの余白（できあがりの短い辺に対する割合。テンプレートの余白 80/1080 と同じ）
const PHONE_MARGIN = 0.074;
// できあがりの幅の下限（小さなスクリーンショットでも Instagram の幅 320px を下回らず、見てわかる大きさにする）
const PHONE_MIN_WIDTH = 1080;

// 画像の向きから、枠の向きをすすめる（正方形までは縦向き）
export function phoneOrientation(srcW: number, srcH: number): PhoneOrientation {
  return srcW / srcH <= 1 ? "portrait" : "landscape";
}

// 画面の縦横（横 ÷ 縦）。画像の比率を、向きごとの範囲に収める
export function phoneScreenRatio(srcW: number, srcH: number, orientation: PhoneOrientation): number {
  const r = srcW / srcH;
  return orientation === "portrait" ? clamp(r, PHONE_SCREEN_RANGE.min, PHONE_SCREEN_RANGE.max) : clamp(r, 1 / PHONE_SCREEN_RANGE.max, 1 / PHONE_SCREEN_RANGE.min);
}

// 画面に入れるときに切る向き（ちょうど入るなら null）。縦向きは上をそろえて下を切る（スマホの画面は上が大事）
export function phoneCropSide(srcW: number, srcH: number, orientation: PhoneOrientation): "bottom" | "sides" | "topBottom" | null {
  const axis = cropAxis(srcW, srcH, phoneScreenRatio(srcW, srcH, orientation));
  if (!axis) return null;
  if (axis === "x") return "sides";
  return orientation === "portrait" ? "bottom" : "topBottom";
}

type Box = { x: number; y: number; w: number; h: number; r: number };
export type PhoneLayout = { w: number; h: number; ring: Box; bezel: Box; screen: Box; crop: Rect };

// W×H の中に、枠を真ん中に置く
function placePhone(W: number, H: number, screenRatio: number, srcW: number, srcH: number, orientation: PhoneOrientation): Omit<PhoneLayout, "w" | "h"> {
  const m = Math.min(W, H) * PHONE_MARGIN;
  const availW = W - m * 2;
  const availH = H - m * 2;
  const k = PHONE_BEZEL + PHONE_RING;
  // 画面の短い辺を s として、縁と輪を足した外側が余白の内に収まる、いちばん大きい s
  const s = screenRatio <= 1 ? Math.min(availW / (1 + 2 * k), availH / (1 / screenRatio + 2 * k)) : Math.min(availW / (screenRatio + 2 * k), availH / (1 + 2 * k));
  const sw = screenRatio <= 1 ? s : s * screenRatio;
  const sh = screenRatio <= 1 ? s / screenRatio : s;
  const bezel = s * PHONE_BEZEL;
  const ring = s * PHONE_RING;
  const r = s * PHONE_RADIUS;
  const x = (W - sw) / 2;
  const y = (H - sh) / 2;
  return {
    ring: { x: x - bezel - ring, y: y - bezel - ring, w: sw + (bezel + ring) * 2, h: sh + (bezel + ring) * 2, r: r + bezel + ring },
    bezel: { x: x - bezel, y: y - bezel, w: sw + bezel * 2, h: sh + bezel * 2, r: r + bezel },
    screen: { x, y, w: sw, h: sh, r },
    crop: cropRect(srcW, srcH, screenRatio, orientation === "portrait" ? 0 : 0.5),
  };
}

// スマホの枠に入れたときのできあがり。画面に入る画像を引き伸ばさない大きさにする（長い辺は 4.18 の上限まで、幅は 1080px 以上）
export function phoneFrameLayout(srcW: number, srcH: number, ratio: number, orientation: PhoneOrientation): PhoneLayout {
  const screenRatio = phoneScreenRatio(srcW, srcH, orientation);
  // 幅 1000 で並べてみて、画面の大きさが切った画像の大きさになる倍率を出す
  const probeH = 1000 / ratio;
  const probe = placePhone(1000, probeH, screenRatio, srcW, srcH, orientation);
  const scale = probe.crop.sw / probe.screen.w;
  const baseW = Math.max(PHONE_MIN_WIDTH, Math.round(1000 * scale));
  const { w, h } = outputSize(baseW, Math.round(baseW / ratio), ratio);
  return { w, h, ...placePhone(w, h, screenRatio, srcW, srcH, orientation) };
}

// Instagram のカルーセルは、2 枚目からが 1 枚目の比率で切られる（公式: "Carousel images are all cropped based on the first image"）。
// 1 枚目と比率が違う画像の番号（0 始まり）
export function carouselMismatches(sizes: { width: number; height: number }[]): number[] {
  if (sizes.length < 2) return [];
  const first = sizes[0].width / sizes[0].height;
  return sizes.flatMap((s, i) => (i > 0 && Math.abs(s.width / s.height - first) / first > 0.01 ? [i] : []));
}

export { instagramRatioOk };
