import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { formatHeadlineTexts } from "@/lib/auto-post/image";
import { autoImageLabel } from "@/lib/auto-post/labels";
import { readAutoImage } from "@/lib/auto-post/plan-row";
import { buildAutoPostRequest, HEADLINE_MAX } from "@/lib/auto-post/prompt";
import { autoImageSchema } from "@/lib/auto-post/schema";
import { headlineInput, initialHeadline } from "@/lib/media/headline";
import { cleanHeadline, HEADLINE_TEXT_MAX } from "@/lib/media/headline-text";
import { SERVER_FONTS } from "@/lib/media/server-fonts";
import { renderTemplateJpeg } from "@/lib/media/template-render-server";
import { FONT_KEYS, PALETTES, TEXT_STYLES } from "@/lib/media/templates";

// 自動の回の画像に見出しを重ねる（docs/design/auto-sample-image.md の 11.。段取り ④）
describe("見出しの文をそろえる（サーバーで描く文と、画面に出す文で同じ）", () => {
  it("絵文字（旗・肌の色・つなぎの字を含む）を取り除く", () => {
    expect(cleanHeadline("今朝の焙煎☕️ はじめました🎉")).toBe("今朝の焙煎 はじめました");
    expect(cleanHeadline("👨‍👩‍👧 家族で🇯🇵 来店👍🏽")).toBe("家族で 来店");
  });
  it("URL・【】・改行を取り除き、空白をそろえ、40 字までにする", () => {
    expect(cleanHeadline("新作 https://example.com/a 【商品名】が\n入荷")).toBe("新作 が 入荷");
    expect([...cleanHeadline("あ".repeat(60))]).toHaveLength(HEADLINE_TEXT_MAX);
    expect(cleanHeadline(null)).toBe("");
    expect(cleanHeadline("🎉🎉")).toBe("");
  });
});

describe("見出しの見た目の設定", () => {
  const base = { source: "ai" as const, style: "illustration" as const, size: "auto" as const, headline: "ai" as const };
  const look = { palette: "kinari", brand: "#e4572e", font: "mincho" as const, textStyle: "band" as const };
  it("色・いつもの色・書体・置き方を持てる。見出しを重ねないときは持てない", () => {
    expect(autoImageSchema.safeParse({ ...base, look }).success).toBe(true);
    expect(autoImageSchema.safeParse({ ...base, headline: "none", look }).success).toBe(false);
    expect(autoImageSchema.safeParse({ ...base, look: { ...look, palette: "rainbow" } }).success).toBe(false);
    expect(autoImageSchema.safeParse({ ...base, look: { ...look, brand: "red" } }).success).toBe(false);
    expect(autoImageSchema.safeParse({ ...base, look: { ...look, extra: 1 } }).success).toBe(false);
  });
  it("DB から読むとき、形の違う見た目は捨てる（見出しは既定の見た目で描く）", () => {
    expect(readAutoImage({ ...base, look })).toEqual({ ...base, look });
    expect(readAutoImage({ ...base, look: { palette: "rainbow" } })).toEqual(base);
  });
  it("DB の auto_image_valid と同じ値の一覧（マイグレーションの文と照らす）", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261120100000_auto_image_look.sql", "utf8");
    for (const k of [...PALETTES.map((p) => p.key), "brand", ...FONT_KEYS, ...TEXT_STYLES]) expect(sql).toContain(`'${k}'`);
  });
  it("回し方の画面の 1 行に見出しを出す", () => {
    expect(autoImageLabel({ ...base, look })).toBe("AI がつくる（イラストで・送り先に合わせる）・見出しは AI が書く");
  });
});

describe("AI に見出しを頼む", () => {
  it("見出しを重ねるときだけ頼み、決まり（字数・絵文字なし）を渡す", () => {
    const ask = JSON.stringify(buildAutoPostRequest({ context: "", material: "メモ", instructions: [], recentBodies: [], headline: true, dueAt: new Date() }).messages);
    expect(ask).toContain("画像に重ねる見出し");
    expect(ask).toContain(`${HEADLINE_MAX} 字まで`);
    expect(ask).toContain("絵文字");
    const no = JSON.stringify(buildAutoPostRequest({ context: "", material: "メモ", instructions: [], recentBodies: [], dueAt: new Date() }).messages);
    expect(no).toContain("headline は null");
  });
});

describe("サーバーで見出しを描く（@napi-rs/canvas と src/server-fonts の書体）", () => {
  it("どの書体でも、写真を敷いて見出しを重ねた JPEG を、写真と同じ大きさで描ける", async () => {
    const photo = createCanvas(800, 1000);
    const pctx = photo.getContext("2d");
    pctx.fillStyle = "#777777";
    pctx.fillRect(0, 0, 800, 1000);
    const photoBytes = new Uint8Array(await photo.encode("jpeg", 90));
    for (const font of FONT_KEYS) {
      const settings = { ...initialHeadline({ width: 800, height: 1000 }, "", { palette: "ai", brand: "#e4572e", font, textStyle: "band" }), headline: "今朝の焙煎は、エチオピアの浅煎り" };
      const { bytes, layout } = await renderTemplateJpeg(headlineInput(settings, SERVER_FONTS[font], { width: 800, height: 1000 }), photoBytes);
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
      const img = await loadImage(Buffer.from(bytes));
      expect([img.width, img.height]).toEqual([layout.w, layout.h]);
      expect(layout.ops.some((o) => o.type === "text" && o.text.length > 0)).toBe(true);
      // 字を描いたところは写真の灰色と違う色になる（書体が読めていなければ、字が描かれない）
      const c = createCanvas(img.width, img.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const text = layout.ops.find((o) => o.type === "text")!;
      if (text.type !== "text") throw new Error("text");
      const { data } = ctx.getImageData(0, Math.max(0, text.y - text.size), img.width, text.size);
      let differ = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 0x77) > 40) differ++;
      expect(differ, font).toBeGreaterThan(50);
    }
  });
});

describe("フォーマットの見出しと上の小さい文（自動の回。2026-11-20 オーナーの指示。見出しを 2 段にする）", () => {
  it("空欄を埋め、絵文字を取り除く。小さい文は見出しがあるときだけ・20 字まで", () => {
    const image = { headline: "この{キーワード}から連想される映画は？🎬", label: "連想映画クイズ {回}" };
    expect(formatHeadlineTexts(image, { キーワード: "画像", 回: "第 3 回" }, null)).toEqual({ headline: "この画像から連想される映画は？", label: "連想映画クイズ 第 3 回" });
    expect(formatHeadlineTexts({ ...image, headline: null }, {}, null)).toEqual({ headline: "", label: "" });
    expect(formatHeadlineTexts({ ...image, label: "あ".repeat(30) }, { キーワード: "画像" }, null).label).toHaveLength(20);
    expect(formatHeadlineTexts({ ...image, label: null }, { キーワード: "画像" }, null).label).toBe("");
  });
});
