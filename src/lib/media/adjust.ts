import { cropRect, outputSize, presetRatio, type AspectKey } from "./aspect";

// 画像を調整する（明るさ・コントラスト・あざやかさ・色あい、回転・まっすぐにする、切り取り。docs/architecture.md の 4.53）。
// 計算だけ（Canvas に描くのは adjust-render.ts）。どれもブラウザーの中だけで、AI も外のサービスも使わない（費用 0）

// スライダーはどれも -100〜100（0 が元のまま）
export const TONE_KEYS = ["brightness", "contrast", "saturation", "warmth"] as const;
export type ToneKey = (typeof TONE_KEYS)[number];
export type Tone = Record<ToneKey, number>;
export const NEUTRAL_TONE: Tone = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];
// まっすぐにする角度（度）。傾いた水平線を直すくらいの小さな角度だけ
export const MAX_STRAIGHTEN = 10;

// 切り取りの枠: 元のまま、または縦横を整えると同じ枠（4:5・1:1・1.91:1）
export type CropKey = "original" | AspectKey;

export type Adjustments = {
  tone: Tone;
  rotation: Rotation;
  straighten: number;
  crop: CropKey;
  // 切り取りで残す場所（0〜1。縦横を整えると同じ）
  pos: number;
};

export const NEUTRAL: Adjustments = { tone: NEUTRAL_TONE, rotation: 0, straighten: 0, crop: "original", pos: 0.5 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function isNeutral(a: Adjustments): boolean {
  return TONE_KEYS.every((k) => a.tone[k] === 0) && a.rotation === 0 && a.straighten === 0 && a.crop === "original";
}

// ===== 色（1 画素ずつ。LUT とあざやかさ） =====

// スライダーの値 → 実際の強さ。どれも「少しずつ」効くようにしてある（素人が動かしすぎても壊れにくい）
export function toneFactors(t: Tone) {
  return {
    // 明るさ: 0〜255 の値に足す量（±60）
    add: clamp(t.brightness, -100, 100) * 0.6,
    // コントラスト: 真ん中（128）からの広げ方（0.4〜1.6 倍）
    contrast: 1 + clamp(t.contrast, -100, 100) * 0.006,
    // あざやかさ: 灰色からの離し方（0〜2 倍）
    saturation: 1 + clamp(t.saturation, -100, 100) / 100,
    // 色あい: 暖かく（赤を足し青を引く）／冷たく（逆）。±25
    warm: clamp(t.warmth, -100, 100) * 0.25,
  };
}

// 赤・緑・青それぞれの 0〜255 → 0〜255 の表（明るさ・コントラスト・色あい）
export function toneLuts(t: Tone): { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray } {
  const f = toneFactors(t);
  const r = new Uint8ClampedArray(256);
  const g = new Uint8ClampedArray(256);
  const b = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const base = (v - 128) * f.contrast + 128 + f.add;
    r[v] = base + f.warm;
    g[v] = base;
    b[v] = base - f.warm;
  }
  return { r, g, b };
}

// RGBA の並び（ImageData.data）をその場で変える
export function applyTone(data: Uint8ClampedArray, t: Tone): void {
  if (TONE_KEYS.every((k) => t[k] === 0)) return;
  const { r: lr, g: lg, b: lb } = toneLuts(t);
  const sat = toneFactors(t).saturation;
  for (let i = 0; i < data.length; i += 4) {
    let r = lr[data[i]];
    let g = lg[data[i + 1]];
    let b = lb[data[i + 2]];
    if (sat !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

// 「おまかせで整える」: 明るさの分布から、明るさとコントラストを少しだけ上げる（下げない。AI は使わない）。
// 暗い写真は明るく、眠い（白と黒の幅が狭い）写真はくっきりさせる。どちらも 25 まで
export function autoTone(data: Uint8ClampedArray): Tone {
  const hist = new Uint32Array(256);
  let n = 0;
  let sum = 0;
  // 大きな画像でも重くならないよう、4 画素に 1 つだけ見る
  for (let i = 0; i < data.length; i += 16) {
    const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[l]++;
    sum += l;
    n++;
  }
  if (n === 0) return NEUTRAL_TONE;
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * p) return v;
    }
    return 255;
  };
  const lo = pct(0.02);
  const hi = pct(0.98);
  const mean = sum / n;
  // 白と黒の幅が 200 に満たなければ広げる（0.6 倍で 1 段）
  const spread = Math.max(1, hi - lo);
  const contrast = clamp(Math.round(((200 / spread - 1) / 0.006) * 0.5), 0, 25);
  // 平均が 120 より暗ければ明るくする
  const brightness = clamp(Math.round(((120 - mean) / 0.6) * 0.5), 0, 25);
  return { ...NEUTRAL_TONE, brightness, contrast };
}

// ===== 形（回転・まっすぐにする・切り取り） =====

// 回転したあとの縦横
export function rotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  return rotation % 180 === 0 ? { w, h } : { w: h, h: w };
}

// まっすぐにするとき、四隅に空きが出ないように大きくする倍率（枠は回転したあとの縦横のまま）
export function straightenScale(w: number, h: number, degrees: number): number {
  const a = (Math.abs(clamp(degrees, -MAX_STRAIGHTEN, MAX_STRAIGHTEN)) * Math.PI) / 180;
  if (a === 0) return 1;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return Math.max((w * cos + h * sin) / w, (w * sin + h * cos) / h);
}

export type AdjustLayout = {
  // 回転したあとの枠（元の画像の px）
  frame: { w: number; h: number };
  // その枠の中で残す範囲
  crop: { sx: number; sy: number; sw: number; sh: number };
  // できあがりの大きさ（長い辺は上げられる上限まで。元より大きくしない）
  out: { w: number; h: number };
  // 描くときの回転（ラジアン。90 度ごと＋まっすぐにする）と倍率
  angle: number;
  scale: number;
};

export function adjustLayout(srcW: number, srcH: number, a: Pick<Adjustments, "rotation" | "straighten" | "crop" | "pos">): AdjustLayout {
  const frame = rotatedSize(srcW, srcH, a.rotation);
  const ratio = a.crop === "original" ? frame.w / frame.h : presetRatio(a.crop);
  const crop = a.crop === "original" ? { sx: 0, sy: 0, sw: frame.w, sh: frame.h } : cropRect(frame.w, frame.h, ratio, a.pos);
  const out = outputSize(crop.sw, crop.sh, crop.sw / crop.sh);
  const straighten = clamp(a.straighten, -MAX_STRAIGHTEN, MAX_STRAIGHTEN);
  return {
    frame,
    crop,
    out,
    angle: ((a.rotation + straighten) * Math.PI) / 180,
    scale: straightenScale(frame.w, frame.h, straighten),
  };
}

// 次の 90 度（右回り）
export function rotateRight(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

// 次の 90 度（左回り）
export function rotateLeft(r: Rotation): Rotation {
  return ((r + 270) % 360) as Rotation;
}

// 同じ調整か（差し替えるボタンを、開いたときと同じなら押せないようにする）
export function sameAdjustments(a: Adjustments, b: Adjustments): boolean {
  if (isNeutral(a) && isNeutral(b)) return true;
  return TONE_KEYS.every((k) => a.tone[k] === b.tone[k]) && a.rotation === b.rotation && a.straighten === b.straighten && a.crop === b.crop && (a.crop === "original" || a.pos === b.pos);
}
