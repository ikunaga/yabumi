import { describe, expect, it } from "vitest";
import { autoImageLabel } from "@/lib/auto-post/labels";
import { readAutoImage } from "@/lib/auto-post/plan-row";
import { autoImageSchema, autoPlanInputSchema } from "@/lib/auto-post/schema";
import type { AutoPlanInput } from "@/lib/auto-post/types";

// 自動の回の画像の設定（docs/design/auto-sample-image.md の 2.。DB の auto_image_valid と同じ決まりかは結合テストで確かめる）
const ai = { source: "ai" as const, style: "photo" as const, size: "auto" as const, headline: "none" as const };
const base: AutoPlanInput = {
  name: "テスト",
  kind: "notes",
  materials: {},
  targets: { threads: "auto" },
  xLink: "never",
  schedule: { weekdays: [2], time: "19:00", every_weeks: 1, start: "2026-11-19" },
  instructions: [],
  image: null,
  leadHours: 24,
  consent: true,
};

describe("画像の設定の入力", () => {
  it("決まった値だけ。ほかのキーは断る", () => {
    expect(autoImageSchema.safeParse(ai).success).toBe(true);
    expect(autoImageSchema.safeParse(null).success).toBe(true);
    expect(autoImageSchema.safeParse({ ...ai, size: "huge" }).success).toBe(false);
    expect(autoImageSchema.safeParse({ ...ai, prompt: "自分で書いた説明" }).success).toBe(false);
    expect(autoImageSchema.safeParse({ ...ai, headline: "format" }).success).toBe(false);
  });
  it("フォーマットの画像はシリーズだけ。商品の紹介はイラストだけ", () => {
    expect(autoPlanInputSchema.safeParse({ ...base, image: { ...ai, source: "format" } }).success).toBe(false);
    expect(autoPlanInputSchema.safeParse({ ...base, kind: "series", materials: { format_id: "00000000-0000-4000-8000-000000000001" }, image: { ...ai, source: "format" } }).success).toBe(true);
    expect(autoPlanInputSchema.safeParse({ ...base, kind: "product", image: ai }).success).toBe(false);
    expect(autoPlanInputSchema.safeParse({ ...base, kind: "product", image: { ...ai, style: "illustration" } }).success).toBe(true);
  });
});

describe("読み取りと表示", () => {
  it("DB の {} や形の違うものは画像なし", () => {
    expect(readAutoImage({})).toBeNull();
    expect(readAutoImage({ source: "ai", style: "photo", size: "auto" })).toBeNull();
    expect(readAutoImage(ai)).toEqual(ai);
  });
  it("回し方の画面の 1 行", () => {
    expect(autoImageLabel(null)).toBe("付けない");
    expect(autoImageLabel({ ...ai, source: "format" })).toBe("フォーマットの画像");
    expect(autoImageLabel({ ...ai, style: "illustration", size: "portrait" })).toBe("AI がつくる（イラストで・縦 4:5）");
  });
});
