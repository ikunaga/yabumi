// 画像の縦横を整える（Instagram の 4:5〜1.91:1）。切り取り・余白の計算、ドラッグ、カルーセルの比率。Canvas は使わない
import { describe, expect, it } from "vitest";
import {
  ASPECT_PRESETS,
  carouselMismatches,
  cropAxis,
  cropOutput,
  cropRect,
  dragToPos,
  instagramRatioOk,
  padLayout,
  presetRatio,
  ratioLabel,
  suggestAspect,
} from "@/lib/media/aspect";
import { TEMPLATE_SIZES } from "@/lib/media/templates";
import { MAX_LONG_EDGE } from "@/lib/media/rules";

const IPHONE = { w: 1170, h: 2532 }; // スマホのスクリーンショット（1:2.16）
const PANORAMA = { w: 3000, h: 1000 }; // 横長すぎる写真（3:1）

describe("どの枠も Instagram に送れる", () => {
  it("4:5・1:1・1.91:1 は範囲の中", () => {
    for (const p of ASPECT_PRESETS) expect(instagramRatioOk(p.ratio * 1000, 1000)).toBe(true);
  });

  it("テンプレートと AI の画像の縦横（4:5・1:1・16:9）も、もとから範囲の中", () => {
    for (const s of Object.values(TEMPLATE_SIZES)) expect(instagramRatioOk(s.w, s.h)).toBe(true);
    expect(instagramRatioOk(1280, 670)).toBe(true); // note のヘッダー（1.91）
  });

  it("縦長すぎる・横長すぎる画像には、近い端の枠をすすめる", () => {
    expect(suggestAspect(IPHONE.w, IPHONE.h)).toBe("4:5");
    expect(suggestAspect(PANORAMA.w, PANORAMA.h)).toBe("1.91:1");
    expect(suggestAspect(1000, 1050)).toBe("1:1");
  });

  it("比率を短く書く", () => {
    expect(ratioLabel(1080, 1350)).toBe("4:5");
    expect(ratioLabel(1600, 900)).toBe("16:9");
    expect(ratioLabel(IPHONE.w, IPHONE.h)).toBe("1:2.16");
    expect(ratioLabel(PANORAMA.w, PANORAMA.h)).toBe("3:1");
  });
});

describe("切り取る", () => {
  it("縦長の画像を 4:5 に切ると、幅はそのまま、上下を切る。位置で上・真ん中・下を選べる", () => {
    const ratio = presetRatio("4:5");
    expect(cropAxis(IPHONE.w, IPHONE.h, ratio)).toBe("y");
    const top = cropRect(IPHONE.w, IPHONE.h, ratio, 0);
    const mid = cropRect(IPHONE.w, IPHONE.h, ratio, 0.5);
    const bottom = cropRect(IPHONE.w, IPHONE.h, ratio, 1);
    expect(top).toEqual({ sx: 0, sy: 0, sw: 1170, sh: 1463 });
    expect(mid.sy).toBe(Math.round((2532 - 1463) / 2));
    expect(bottom.sy + bottom.sh).toBe(2532);
    expect(instagramRatioOk(mid.sw, mid.sh)).toBe(true);
  });

  it("横長の画像を 1.91:1 に切ると、左右を切る。範囲の外の位置は端にとどめる", () => {
    const ratio = presetRatio("1.91:1");
    expect(cropAxis(PANORAMA.w, PANORAMA.h, ratio)).toBe("x");
    expect(cropRect(PANORAMA.w, PANORAMA.h, ratio, -1)).toEqual(cropRect(PANORAMA.w, PANORAMA.h, ratio, 0));
    const r = cropRect(PANORAMA.w, PANORAMA.h, ratio, 2);
    expect(r.sx + r.sw).toBe(3000);
  });

  it("できあがりは長い辺 2,048px まで、比率どおりで、Instagram の範囲に入る", () => {
    for (const p of ASPECT_PRESETS) {
      for (const src of [IPHONE, PANORAMA, { w: 4032, h: 3024 }, { w: 400, h: 2000 }]) {
        const out = cropOutput(src.w, src.h, p.ratio);
        expect(Math.max(out.w, out.h)).toBeLessThanOrEqual(MAX_LONG_EDGE);
        expect(Math.abs(out.w / out.h - p.ratio)).toBeLessThan(0.01);
        expect(instagramRatioOk(out.w, out.h)).toBe(true);
      }
    }
  });

  it("ちょうどの比率なら動かす向きはない", () => {
    expect(cropAxis(1080, 1350, presetRatio("4:5"))).toBeNull();
  });

  it("ドラッグ: 指を下へ動かすと、上のほうが見えるようになる（位置が小さくなる）", () => {
    const ratio = presetRatio("4:5");
    const next = dragToPos(0.5, 100, IPHONE.w, IPHONE.h, ratio, 400);
    expect(next).toBeLessThan(0.5);
    expect(dragToPos(0.5, -10000, IPHONE.w, IPHONE.h, ratio, 400)).toBe(1);
    expect(dragToPos(0.5, 10000, IPHONE.w, IPHONE.h, ratio, 400)).toBe(0);
    // 余りのない向きには動かない
    expect(dragToPos(0.3, 50, 1080, 1350, ratio, 400)).toBe(0.3);
  });
});

describe("余白を足す", () => {
  it("画像をまるごと収め、足りない向きにだけ地を足す", () => {
    const l = padLayout(IPHONE.w, IPHONE.h, presetRatio("4:5"));
    expect(Math.abs(l.w / l.h - 0.8)).toBeLessThan(0.01);
    expect(l.dh).toBe(l.h);
    expect(l.dx).toBeGreaterThan(0);
    expect(l.dx * 2 + l.dw).toBeLessThanOrEqual(l.w + 1);
    expect(Math.abs(l.dw / l.dh - IPHONE.w / IPHONE.h)).toBeLessThan(0.01);
    expect(Math.max(l.w, l.h)).toBeLessThanOrEqual(MAX_LONG_EDGE);

    const p = padLayout(PANORAMA.w, PANORAMA.h, presetRatio("1.91:1"));
    expect(p.dw).toBe(p.w);
    expect(p.dy).toBeGreaterThan(0);
    expect(instagramRatioOk(p.w, p.h)).toBe(true);
  });
});

describe("カルーセル（2 枚目からは 1 枚目の比率で切られる）", () => {
  it("1 枚目と比率が違う画像の番号を返す", () => {
    expect(carouselMismatches([{ width: 1080, height: 1350 }])).toEqual([]);
    expect(
      carouselMismatches([
        { width: 1080, height: 1350 },
        { width: 2160, height: 2700 },
        { width: 1080, height: 1080 },
        { width: 1600, height: 900 },
      ]),
    ).toEqual([2, 3]);
  });
});
