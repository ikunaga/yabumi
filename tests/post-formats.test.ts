// 投稿のフォーマット（docs/design/post-formats.md）: 穴の読み方、本文に入れる、穴の言葉の整え方、例
import { describe, expect, it } from "vitest";
import { styleProblems } from "@/lib/ai/japanese-style";
import { PRODUCT_TYPES } from "@/lib/projects/product-types";
import { FORMAT_EXAMPLES, MAX_FORMAT_SLOTS, cleanSlotValues, fillFormat, formatInputSchema, formatSlots, insertFormatted, slotProblem } from "@/lib/post-formats/schema";

describe("穴の読み方", () => {
  it("出てくる順に、同じ名前は 1 つ。前後の空白は落とす", () => {
    expect(formatSlots("{何が}を{ いつから }に。また{何が}")).toEqual(["何が", "いつから"]);
    expect(formatSlots("穴なし")).toEqual([]);
  });

  it("8 種類まで・名前は 12 字まで・空の {} は置かない", () => {
    expect(slotProblem("{a}{b}")).toBeNull();
    expect(slotProblem(Array.from({ length: MAX_FORMAT_SLOTS + 1 }, (_, i) => `{穴${i}}`).join(""))).toMatch(/8 種類/);
    expect(slotProblem("{あいうえおかきくけこさしす}")).toMatch(/12 字/);
    expect(slotProblem("{}です")).toMatch(/穴の名前/);
    // 同じ名前を重ねても 16 か所まで（DB の check と同じ）
    expect(slotProblem("{a}".repeat(17))).toMatch(/16 か所/);
  });

  it("入力を整える: 名前・いつ使うは 1 行に、本文の改行はそろえる", () => {
    const p = formatInputSchema.parse({ name: " 新\nメニュー ", purpose: "x", body: "a\r\nb", example: "", pillar: "" });
    expect(p).toMatchObject({ name: "新 メニュー", body: "a\nb" });
    expect(formatInputSchema.safeParse({ name: "", body: "x" }).success).toBe(false);
    expect(formatInputSchema.safeParse({ name: "x", body: "{}" }).success).toBe(false);
  });
});

describe("本文に入れる", () => {
  it("埋めた穴は言葉に、埋めなかった穴は【穴の名前】で残す", () => {
    expect(fillFormat("【新メニュー】{何が}\n{いつから}から、{いくら}です。", { 何が: "栗のタルト", いつから: " 11 月 15 日 " })).toBe("【新メニュー】栗のタルト\n11 月 15 日から、【いくら】です。");
  });

  it("いまの本文が空なら埋めた本文、置きかえる・下に足す（空行を 1 つあける）", () => {
    expect(insertFormatted("  ", "型", "append")).toBe("型");
    expect(insertFormatted("前の文\n", "型", "append")).toBe("前の文\n\n型");
    expect(insertFormatted("前の文", "型", "replace")).toBe("型");
  });

  it("穴の言葉: 知らない穴・空の言葉は捨て、1 行・200 字まで", () => {
    expect(cleanSlotValues("{何が}{いつ}", { 何が: "栗\nのタルト", いつ: " ", ほか: "x", いくら: 1 })).toEqual({ 何が: "栗 のタルト" });
    expect(cleanSlotValues("{何が}", { 何が: "あ".repeat(250) }).何が).toHaveLength(200);
    expect(cleanSlotValues("{何が}", null)).toEqual({});
  });
});

describe("例", () => {
  it("どの種類にも例があり、保存できる形で、型の言葉が日本語の決まりに引っかからない", () => {
    for (const t of PRODUCT_TYPES) {
      const list = FORMAT_EXAMPLES[t];
      expect(list.length, t).toBeGreaterThanOrEqual(2);
      expect(new Set(list.map((e) => e.name)).size, t).toBe(list.length);
      for (const e of list) {
        expect(formatInputSchema.safeParse(e).success, `${t} ${e.name}`).toBe(true);
        expect(formatSlots(e.body).length, `${t} ${e.name}`).toBeGreaterThan(0);
        // 穴に入る言葉しだいで変わるもの（語尾・体言止め・「。」のそろい）は見ず、型の言葉で決まるものだけを見る
        const fixed = styleProblems(fillFormat(e.body, Object.fromEntries(formatSlots(e.body).map((s) => [s, "あれ"]))), { sns: "instagram" });
        expect(fixed.filter((p) => ["marks", "calling", "deco", "cliche", "katakana", "bullets", "customer"].includes(p.key)), `${t} ${e.name}`).toEqual([]);
      }
    }
  });
});
