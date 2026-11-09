// 画像の文字の見た目（2026-11-09 オーナーの指摘「フォントがいかにも AI くさい」）: 書体の読み替え、置き方の型、
// カタカナの言葉を途中で折らない、控えめな見出し（大きさと太さ）、写真の上の影を薄く・狭く
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_STYLE,
  FONT_KEYS,
  PALETTES,
  TEXT_STYLES,
  fontKeyOf,
  layoutTemplate,
  textStyleOf,
  wrapLines,
  type FontFace,
  type Measure,
  type TemplateInput,
} from "@/lib/media/templates";

const measure: Measure = (text, _font, size) => [...text].reduce((w, ch) => w + (/[\x20-\x7e]/.test(ch) ? size * 0.55 : size), 0);
const heading: FontFace = { family: "test", weight: 700 };
const calm: FontFace = { family: "test", weight: 500 };
const fonts = { heading, calm, body: { family: "test", weight: 500 }, bodyBold: heading };
const base: TemplateInput = {
  kind: "card",
  size: "portrait",
  palette: PALETTES[0],
  fonts,
  label: "新メニュー",
  headline: "金曜の朝だけ、くるみとレーズンのカンパーニュを焼きます",
  subline: "噛むほど甘みが出る、固めのパンです",
  footer: "こむぎ日和",
  diagramStyle: "points",
  items: [],
  screenshot: null,
};
const texts = (l: ReturnType<typeof layoutTemplate>) => l.ops.flatMap((o) => (o.type === "text" ? [o] : []));
const headlineOf = (l: ReturnType<typeof layoutTemplate>) => texts(l).filter((t) => t.font === calm || t.font === heading).sort((a, b) => b.size - a.size)[0];

describe("書体と置き方の読み替え", () => {
  it("やめた「力強い」は「すっきり」に読み替え、知らない値は null。置き方は、覚えていなければ既定（左に控えめ）", () => {
    expect(fontKeyOf("pop")).toBe("gothic");
    for (const k of FONT_KEYS) expect(fontKeyOf(k)).toBe(k);
    expect(fontKeyOf("comic")).toBeNull();
    expect(fontKeyOf(undefined)).toBeNull();
    expect(DEFAULT_TEXT_STYLE).toBe("quiet");
    expect(textStyleOf(undefined)).toBe("quiet");
    expect(textStyleOf("band")).toBe("band");
    expect(textStyleOf("shadow")).toBe("quiet");
  });
});

describe("カタカナの言葉を途中で折らない", () => {
  it("「カンパーニュ」を行の境目で切らない（1 行に入らない長さなら字で折る）", () => {
    const lines = wrapLines("くるみとレーズンのカンパーニュを焼きます", 11 * 40, heading, 40, measure);
    expect(lines.some((l) => l.includes("カンパーニュ"))).toBe(true);
    const long = wrapLines("アイウエオカキクケコサシスセソ", 5 * 40, heading, 40, measure);
    expect(long.every((l) => measure(l, heading, 40) <= 5 * 40)).toBe(true);
  });
});

describe("置き方の型", () => {
  it("既定（左に控えめ）は、前の型（大きく）より見出しが小さく細い。影・グラデーション・縁取りを使わない", () => {
    const quiet = layoutTemplate(base, measure);
    const big = layoutTemplate({ ...base, textStyle: "big" }, measure);
    expect(headlineOf(quiet).font).toBe(calm);
    expect(headlineOf(big).font).toBe(heading);
    expect(headlineOf(quiet).size).toBeLessThan(headlineOf(big).size);
    expect(headlineOf(quiet).size).toBeLessThanOrEqual(84);
    expect(quiet.ops.some((o) => o.type === "shade")).toBe(false);
  });

  it("どの置き方でも、見出し・ラベル・補足・名前が入り、画像からはみ出さない", () => {
    for (const kind of ["card", "note"] as const) {
      for (const textStyle of TEXT_STYLES) {
        const l = layoutTemplate({ ...base, kind, textStyle }, measure);
        const all = texts(l).map((t) => t.text).join("");
        for (const s of ["新メニュー", "固めのパン", "こむぎ日和"]) expect(all, `${kind} ${textStyle}`).toContain(s);
        for (const t of texts(l)) expect(t.y, `${kind} ${textStyle}`).toBeLessThanOrEqual(l.h);
      }
    }
  });

  it("帯の上は、帯の色（アクセント）の上に背景の色で文字を置く", () => {
    const l = layoutTemplate({ ...base, textStyle: "band" }, measure);
    expect(l.ops.some((o) => o.type === "rect" && o.fill === PALETTES[0].accent && o.w === l.w)).toBe(true);
    expect(headlineOf(l).color).toBe(PALETTES[0].bg);
  });

  it("写真を全面に敷くとき、既定は上だけを薄く暗くし（前の 0.72 より薄い）、帯の上は白い帯に濃い文字", () => {
    const photo: TemplateInput = { ...base, kind: "screen", photoFit: "cover", screenshot: { w: 1600, h: 1200 } };
    const quiet = layoutTemplate(photo, measure);
    const shade = quiet.ops.find((o) => o.type === "shade");
    expect(shade && shade.type === "shade" && shade.y).toBe(0);
    expect(shade && shade.type === "shade" ? shade.from : "").toBe("rgba(0,0,0,0.42)");
    const big = layoutTemplate({ ...photo, textStyle: "big" }, measure);
    expect(big.ops.some((o) => o.type === "shade" && o.to === "rgba(0,0,0,0.72)")).toBe(true);
    const band = layoutTemplate({ ...photo, textStyle: "band" }, measure);
    expect(band.ops.some((o) => o.type === "rect" && o.fill === "rgba(255,255,255,0.94)")).toBe(true);
    expect(headlineOf(band).color).toBe("#1f1f1f");
  });
});
