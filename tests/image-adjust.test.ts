// 画像を調整する（明るさ・コントラスト・あざやかさ・色あい、おまかせ、回転・まっすぐにする・切り取り）と、整え方を重ねるときの元のたどり方。Canvas は使わない
import { describe, expect, it } from "vitest";
import {
  NEUTRAL,
  NEUTRAL_TONE,
  adjustLayout,
  applyTone,
  autoTone,
  isNeutral,
  rotateLeft,
  rotateRight,
  rotatedSize,
  sameAdjustments,
  straightenScale,
  toneLuts,
} from "@/lib/media/adjust";
import { editSource, editedIds, staleAfterEdit } from "@/lib/media/image-edit";
import { MAX_LONG_EDGE } from "@/lib/media/rules";

// 1 色で塗った n 画素の RGBA
function solid(n: number, [r, g, b]: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < d.length; i += 4) d.set([r, g, b, 255], i);
  return d;
}

// 明るさが lo〜hi に均等に並ぶ灰色の画像
function ramp(lo: number, hi: number, n = 4000): Uint8ClampedArray {
  const d = new Uint8ClampedArray(n * 4);
  for (let k = 0; k < n; k++) {
    const v = Math.round(lo + ((hi - lo) * k) / (n - 1));
    d.set([v, v, v, 255], k * 4);
  }
  return d;
}

describe("色の調整", () => {
  it("どれも 0 なら画素を変えない", () => {
    const d = solid(3, [10, 120, 250]);
    applyTone(d, NEUTRAL_TONE);
    expect([...d.slice(0, 4)]).toEqual([10, 120, 250, 255]);
  });

  it("明るさは足し、暗くすると引く。0〜255 からはみ出さない", () => {
    const up = solid(1, [100, 100, 250]);
    applyTone(up, { ...NEUTRAL_TONE, brightness: 50 });
    expect(up[0]).toBe(130);
    expect(up[2]).toBe(255);
    const down = solid(1, [100, 100, 10]);
    applyTone(down, { ...NEUTRAL_TONE, brightness: -50 });
    expect(down[0]).toBe(70);
    expect(down[2]).toBe(0);
  });

  it("コントラストは真ん中から離す（くっきり）・近づける（やわらかく）", () => {
    const hi = toneLuts({ ...NEUTRAL_TONE, contrast: 50 });
    expect(hi.g[200]).toBeGreaterThan(200);
    expect(hi.g[60]).toBeLessThan(60);
    const lo = toneLuts({ ...NEUTRAL_TONE, contrast: -50 });
    expect(lo.g[200]).toBeLessThan(200);
    expect(lo.g[60]).toBeGreaterThan(60);
  });

  it("あざやかさを下げきると灰色になり、上げると色の差が広がる。灰色は変わらない", () => {
    const gray = solid(1, [200, 50, 50]);
    applyTone(gray, { ...NEUTRAL_TONE, saturation: -100 });
    expect(gray[0]).toBe(gray[1]);
    expect(gray[1]).toBe(gray[2]);
    const vivid = solid(1, [150, 100, 100]);
    applyTone(vivid, { ...NEUTRAL_TONE, saturation: 50 });
    expect(vivid[0] - vivid[1]).toBeGreaterThan(50);
    const plain = solid(1, [128, 128, 128]);
    applyTone(plain, { ...NEUTRAL_TONE, saturation: 80 });
    expect([...plain.slice(0, 3)]).toEqual([128, 128, 128]);
  });

  it("暖かくは赤を足して青を引き、冷たくは逆", () => {
    const warm = solid(1, [128, 128, 128]);
    applyTone(warm, { ...NEUTRAL_TONE, warmth: 40 });
    expect(warm[0]).toBeGreaterThan(128);
    expect(warm[1]).toBe(128);
    expect(warm[2]).toBeLessThan(128);
    const cool = solid(1, [128, 128, 128]);
    applyTone(cool, { ...NEUTRAL_TONE, warmth: -40 });
    expect(cool[0]).toBeLessThan(128);
    expect(cool[2]).toBeGreaterThan(128);
  });

  it("透明度（アルファ）は変えない", () => {
    const d = new Uint8ClampedArray([100, 100, 100, 77]);
    applyTone(d, { brightness: 30, contrast: 30, saturation: 30, warmth: 30 });
    expect(d[3]).toBe(77);
  });
});

describe("おまかせで整える", () => {
  it("暗くて眠い写真は、明るさとコントラストを少し上げる（25 まで）", () => {
    const t = autoTone(ramp(20, 120));
    expect(t.brightness).toBeGreaterThan(0);
    expect(t.contrast).toBeGreaterThan(0);
    expect(t.brightness).toBeLessThanOrEqual(25);
    expect(t.contrast).toBeLessThanOrEqual(25);
    expect(t.saturation).toBe(0);
    expect(t.warmth).toBe(0);
  });

  it("明るさも幅も足りている写真は、ほとんど変えない", () => {
    const t = autoTone(ramp(0, 255));
    expect(t.contrast).toBe(0);
    expect(t.brightness).toBeLessThanOrEqual(5);
  });

  it("明るすぎる写真でも下げない（上げるだけ）", () => {
    const t = autoTone(ramp(180, 250));
    expect(t.brightness).toBe(0);
    expect(t.contrast).toBeGreaterThanOrEqual(0);
  });

  it("画素がなければ何もしない", () => {
    expect(autoTone(new Uint8ClampedArray(0))).toEqual(NEUTRAL_TONE);
  });
});

describe("回転・まっすぐにする・切り取り", () => {
  it("90 度ごとに回すと縦横が入れ替わり、4 回で元に戻る", () => {
    expect(rotatedSize(1200, 800, 90)).toEqual({ w: 800, h: 1200 });
    expect(rotatedSize(1200, 800, 180)).toEqual({ w: 1200, h: 800 });
    let r = NEUTRAL.rotation;
    for (let k = 0; k < 4; k++) r = rotateRight(r);
    expect(r).toBe(0);
    expect(rotateRight(0)).toBe(90);
    expect(rotateLeft(0)).toBe(270);
    expect(rotateLeft(rotateRight(180))).toBe(180);
  });

  it("まっすぐにすると、四隅に空きが出ないだけ大きくする", () => {
    expect(straightenScale(1200, 800, 0)).toBe(1);
    const w = 1200;
    const h = 800;
    const deg = 5;
    const s = straightenScale(w, h, deg);
    expect(s).toBeGreaterThan(1);
    // 枠の四隅を、画像の向きに戻したときに、大きくした画像の中に入る
    const a = (deg * Math.PI) / 180;
    for (const [x, y] of [
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ]) {
      const ix = Math.abs(x * Math.cos(a) + y * Math.sin(a));
      const iy = Math.abs(-x * Math.sin(a) + y * Math.cos(a));
      expect(ix).toBeLessThanOrEqual((w * s) / 2 + 1e-6);
      expect(iy).toBeLessThanOrEqual((h * s) / 2 + 1e-6);
    }
    // 角度は 10 度まで
    expect(straightenScale(w, h, 40)).toBeCloseTo(straightenScale(w, h, 10));
  });

  it("切り取らなければ、回した枠のまま。長い辺は上げられる上限まで", () => {
    const l = adjustLayout(3000, 2000, { ...NEUTRAL, rotation: 90 });
    expect(l.frame).toEqual({ w: 2000, h: 3000 });
    expect(l.crop).toEqual({ sx: 0, sy: 0, sw: 2000, sh: 3000 });
    expect(Math.max(l.out.w, l.out.h)).toBe(MAX_LONG_EDGE);
    expect(l.angle).toBeCloseTo(Math.PI / 2);
  });

  it("切り取りは縦横を整えると同じ枠で、回したあとの向きで残す場所を動かせる", () => {
    const left = adjustLayout(1600, 1200, { ...NEUTRAL, crop: "1:1", pos: 0 });
    expect(left.crop).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 1200 });
    const right = adjustLayout(1600, 1200, { ...NEUTRAL, crop: "1:1", pos: 1 });
    expect(right.crop.sx).toBe(400);
    expect(right.out).toEqual({ w: 1200, h: 1200 });
    // 横長を 90 度回すと縦長になり、4:5 は上下を切る
    const turned = adjustLayout(1600, 1200, { ...NEUTRAL, rotation: 90, crop: "4:5", pos: 0 });
    expect(turned.frame).toEqual({ w: 1200, h: 1600 });
    expect(turned.crop.sw).toBe(1200);
    expect(turned.crop.sh).toBe(1500);
    expect(turned.out.w / turned.out.h).toBeCloseTo(4 / 5, 2);
  });

  it("元のままかどうか・同じ調整かどうか", () => {
    expect(isNeutral(NEUTRAL)).toBe(true);
    expect(isNeutral({ ...NEUTRAL, straighten: 1 })).toBe(false);
    // 切り取らないときは、残す場所の違いは同じとみなす
    expect(sameAdjustments(NEUTRAL, { ...NEUTRAL, pos: 0.2 })).toBe(true);
    expect(sameAdjustments({ ...NEUTRAL, crop: "1:1", pos: 0.5 }, { ...NEUTRAL, crop: "1:1", pos: 0.2 })).toBe(false);
    expect(sameAdjustments({ ...NEUTRAL, tone: { ...NEUTRAL_TONE, warmth: 10 } }, NEUTRAL)).toBe(false);
  });
});

describe("縦横を整える・調整するを重ねるときの元", () => {
  const O = { id: "O" };
  it("整えていない画像は、その画像から描く", () => {
    expect(editSource(O, "adjust")).toBe(O);
    expect(editedIds(O)).toEqual(["O"]);
  });

  it("同じ整え方でやり直すときは前の元から、違う整え方ならいまの画像に重ねる", () => {
    const A = { id: "A", original: O, edit: { kind: "aspect" as const, base: O } };
    expect(editSource(A, "aspect")).toBe(O);
    expect(editSource(A, "adjust")).toBe(A);
    // 縦横を整えた A に調整を重ねた B
    const B = { id: "B", original: O, edit: { kind: "adjust" as const, base: A } };
    expect(editSource(B, "adjust")).toBe(A);
    expect(editSource(B, "aspect")).toBe(B);
  });

  it("差し替えたあと、元にも描き直す元にもならない画像だけを消す", () => {
    const A = { id: "A", original: O, edit: { kind: "aspect" as const, base: O } };
    // 縦横をやり直す: A は要らない（元の O から描き直す）
    expect(staleAfterEdit(A, "aspect", "A2")).toEqual(["A"]);
    // 調整を重ねる: A は描き直す元として残す
    expect(staleAfterEdit(A, "adjust", "B")).toEqual([]);
    const B = { id: "B", original: O, edit: { kind: "adjust" as const, base: A } };
    // 調整をやり直す: B だけ要らない
    expect(staleAfterEdit(B, "adjust", "B2")).toEqual(["B"]);
    // さらに縦横を整える: B が元になり、その前の A は要らない
    expect(staleAfterEdit(B, "aspect", "C")).toEqual(["A"]);
    // 元に戻す・外す: 元の O は残し、B と A を消す
    expect(editedIds(B)).toEqual(["B", "A"]);
  });
});
