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
  phoneCropSide,
  phoneFrameLayout,
  phoneOrientation,
  phoneScreenRatio,
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

describe("スマホの枠に入れる", () => {
  const inside = (outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }) =>
    inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.w <= outer.x + outer.w + 0.01 && inner.y + inner.h <= outer.y + outer.h + 0.01;

  it("縦長のスクリーンショット（9:19.5）は、縦向きの枠の画面にそのまま入る（切らない）", () => {
    const shot = { w: 1080, h: 2340 };
    expect(phoneOrientation(shot.w, shot.h)).toBe("portrait");
    expect(phoneCropSide(shot.w, shot.h, "portrait")).toBeNull();
    for (const p of ASPECT_PRESETS) {
      const l = phoneFrameLayout(shot.w, shot.h, p.ratio, "portrait");
      // できあがりは選んだ枠の比率で、Instagram に送れる
      expect(Math.abs(l.w / l.h - p.ratio) / p.ratio).toBeLessThan(0.01);
      expect(instagramRatioOk(l.w, l.h)).toBe(true);
      expect(Math.max(l.w, l.h)).toBeLessThanOrEqual(MAX_LONG_EDGE);
      // 画面は画像と同じ比率で、画像をまるごと使う
      expect(Math.abs(l.screen.w / l.screen.h - shot.w / shot.h)).toBeLessThan(0.005);
      expect(l.crop).toEqual({ sx: 0, sy: 0, sw: shot.w, sh: shot.h });
      // 輪 ⊃ 縁 ⊃ 画面、輪はできあがりの中に余白を残して収まる、真ん中に置く
      expect(inside(l.ring, l.bezel) && inside(l.bezel, l.screen)).toBe(true);
      expect(l.ring.x).toBeGreaterThan(0);
      expect(l.ring.y).toBeGreaterThan(0);
      expect(l.ring.x + l.ring.w).toBeLessThan(l.w);
      expect(l.ring.y + l.ring.h).toBeLessThan(l.h);
      expect(Math.abs(l.screen.x + l.screen.w / 2 - l.w / 2)).toBeLessThan(0.01);
      expect(Math.abs(l.screen.y + l.screen.h / 2 - l.h / 2)).toBeLessThan(0.01);
    }
  });

  it("縦に長すぎる画像（縦に長いスクロールの画面）は、上をそろえて下を切る", () => {
    const tall = { w: 1080, h: 4000 };
    expect(phoneScreenRatio(tall.w, tall.h, "portrait")).toBeCloseTo(9 / 21);
    expect(phoneCropSide(tall.w, tall.h, "portrait")).toBe("bottom");
    const l = phoneFrameLayout(tall.w, tall.h, presetRatio("4:5"), "portrait");
    expect(l.crop.sy).toBe(0);
    expect(l.crop.sh).toBeLessThan(tall.h);
  });

  it("横長の画像は横向きの枠をすすめる。16:9 はそのまま入り、縦向きにすると左右を切る", () => {
    const wide = { w: 1600, h: 900 };
    expect(phoneOrientation(wide.w, wide.h)).toBe("landscape");
    expect(phoneCropSide(wide.w, wide.h, "landscape")).toBeNull();
    const l = phoneFrameLayout(wide.w, wide.h, presetRatio("1.91:1"), "landscape");
    expect(l.screen.w).toBeGreaterThan(l.screen.h);
    expect(instagramRatioOk(l.w, l.h)).toBe(true);
    expect(phoneCropSide(wide.w, wide.h, "portrait")).toBe("sides");
    expect(phoneCropSide(3000, 1000, "landscape")).toBe("sides");
    // 正方形は縦向き。画面はスマホに見える 9:16 までにして、左右を切る（3:4 まで広げるとタブレットに見える）
    expect(phoneOrientation(1000, 1000)).toBe("portrait");
    expect(phoneScreenRatio(1000, 1000, "portrait")).toBeCloseTo(9 / 16);
    expect(phoneCropSide(1000, 1000, "portrait")).toBe("sides");
    expect(phoneScreenRatio(wide.w, wide.h, "portrait")).toBeCloseTo(9 / 16);
  });

  it("画面に入れる画像を引き伸ばさない（長い辺の上限まで）。小さな画像でも幅 1080px はある", () => {
    const big = phoneFrameLayout(1290, 2796, presetRatio("4:5"), "portrait");
    expect(Math.max(big.w, big.h)).toBe(MAX_LONG_EDGE);
    const small = phoneFrameLayout(390, 844, presetRatio("4:5"), "portrait");
    expect(small.w).toBe(1080);
    const fit = phoneFrameLayout(600, 1300, presetRatio("1:1"), "portrait");
    expect(fit.screen.w).toBeGreaterThanOrEqual(600 - 1);
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
