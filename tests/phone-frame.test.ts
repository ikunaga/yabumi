// スマホの枠の描き方（「縦横を整える」とテンプレートの「写真に見出し」で共通）。縁の太さ・カメラの穴・ボタン・横向き
import { describe, expect, it } from "vitest";
import { PHONE_EDGE, PHONE_PARTS, phoneFrameOps } from "@/lib/media/phone-frame";
import { layoutTemplate, PALETTES, type DrawOp, type FontSet, type TemplateInput } from "@/lib/media/templates";

const rects = (ops: DrawOp[]) => ops.flatMap((o) => (o.type === "rect" ? [o] : []));
const circles = (ops: DrawOp[]) => ops.flatMap((o) => (o.type === "circle" ? [o] : []));
const PORTRAIT = { x: 100, y: 50, w: 540, h: 1170 }; // 9:19.5
const LANDSCAPE = { x: 50, y: 100, w: 1170, h: 540 };

describe("スマホの枠", () => {
  it("縁は画面の短い辺の 4% 以上（ひと目でスマホとわかる太さ）。帯・縁・輪は画面を囲み、ボタンまで含めても PHONE_EDGE の内", () => {
    expect(PHONE_PARTS.bezel).toBeGreaterThanOrEqual(0.04);
    for (const color of ["black", "white"] as const) {
      const f = phoneFrameOps(PORTRAIT, "portrait", color);
      const rs = rects(f.back);
      const s = PORTRAIT.w;
      const edge = PHONE_EDGE * s + 0.01;
      for (const r of rs) {
        expect(r.x).toBeGreaterThanOrEqual(PORTRAIT.x - edge);
        expect(r.y).toBeGreaterThanOrEqual(PORTRAIT.y - edge);
        expect(r.x + r.w).toBeLessThanOrEqual(PORTRAIT.x + PORTRAIT.w + edge);
        expect(r.y + r.h).toBeLessThanOrEqual(PORTRAIT.y + PORTRAIT.h + edge);
      }
      // 縁（最後に描く rect）は画面を bezel の太さで囲む
      const bezel = rs[rs.length - 1];
      expect(bezel.x).toBeCloseTo(PORTRAIT.x - s * PHONE_PARTS.bezel);
      expect(bezel.w).toBeCloseTo(PORTRAIT.w + s * PHONE_PARTS.bezel * 2);
      // 画面の角は今の端末らしく大きめに丸める
      expect(f.screenR).toBeCloseTo(s * PHONE_PARTS.radius);
    }
    // 黒と白で、縁の色が違う
    expect(rects(phoneFrameOps(PORTRAIT, "portrait", "black").back).at(-1)!.fill).not.toBe(rects(phoneFrameOps(PORTRAIT, "portrait", "white").back).at(-1)!.fill);
  });

  it("カメラの穴は、画面の中の上の真ん中。ステータスバー（Android の標準 24dp ≒ 幅の 5.8%）の内に収まる小さな丸", () => {
    const f = phoneFrameOps(PORTRAIT, "portrait", "black");
    const s = PORTRAIT.w;
    expect(f.camera.cx).toBeCloseTo(PORTRAIT.x + PORTRAIT.w / 2);
    expect(f.camera.cy - f.camera.r).toBeGreaterThan(PORTRAIT.y);
    expect(f.camera.cy + f.camera.r - PORTRAIT.y).toBeLessThanOrEqual(s * 0.058);
    expect(f.camera.r).toBeLessThan(s * 0.025);
    expect(circles(f.front)).toHaveLength(2);
  });

  it("側面のボタンは左に 1 本・右に 1 本、帯から少しだけ出す", () => {
    const f = phoneFrameOps(PORTRAIT, "portrait", "black");
    const band = rects(f.back)[3];
    // いちばん外の輪（最初の rect）を除いて、帯の外に出ているもの
    const out = rects(f.back).slice(1).filter((r) => r.x < band.x || r.x + r.w > band.x + band.w);
    expect(out).toHaveLength(2);
    for (const b of out) expect(Math.max(band.x - b.x, b.x + b.w - (band.x + band.w))).toBeCloseTo(PORTRAIT.w * PHONE_PARTS.button);
  });

  it("横向きは 90 度回した形。カメラは左の真ん中、ボタンは上と下に出る", () => {
    const f = phoneFrameOps(LANDSCAPE, "landscape", "white");
    const s = LANDSCAPE.h;
    expect(f.camera.cy).toBeCloseTo(LANDSCAPE.y + LANDSCAPE.h / 2);
    expect(f.camera.cx).toBeCloseTo(LANDSCAPE.x + s * PHONE_PARTS.cameraTop);
    const band = rects(f.back)[3];
    expect(band.w).toBeGreaterThan(band.h);
    const out = rects(f.back).slice(1).filter((r) => r.y < band.y || r.y + r.h > band.y + band.h);
    expect(out).toHaveLength(2);
    expect(rects(f.back).slice(1).every((r) => r.x >= band.x - 0.01 && r.x + r.w <= band.x + band.w + 0.01)).toBe(true);
  });
});

describe("テンプレートの「写真に見出し」も同じ枠", () => {
  const face = { family: "sans-serif", weight: 400 };
  const fonts: FontSet = { heading: face, body: face, bodyBold: face };
  const base: TemplateInput = { kind: "screen", size: "portrait", palette: PALETTES[0], fonts, label: "", headline: "見出し", subline: "", footer: "", diagramStyle: "points", items: [], screenshot: { w: 1170, h: 2532 } };
  const measure = (t: string, _f: unknown, size: number) => t.length * size;

  it("縦長の画面はスマホの枠（カメラの穴あり）。選ぶ前の見本の枠もスマホに見える", () => {
    for (const screenshot of [{ w: 1170, h: 2532 }, null]) {
      const l = layoutTemplate({ ...base, screenshot }, measure);
      expect(circles(l.ops)).toHaveLength(2);
      const screen = l.ops.find((o) => o.type === "image" || o.type === "placeholder")!;
      // カメラの穴は画面より後に描く（画面の上に重なる）
      expect(l.ops.indexOf(screen)).toBeLessThan(l.ops.findIndex((o) => o.type === "circle"));
    }
  });

  it("横長の画面（PC）は、カメラの穴のない角丸の縁のまま", () => {
    const l = layoutTemplate({ ...base, size: "landscape", screenshot: { w: 1600, h: 900 } }, measure);
    expect(circles(l.ops)).toHaveLength(0);
  });
});
