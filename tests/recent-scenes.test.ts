// 前に使った絵の説明（絵の説明のフォーマットの代わり。2026-11-21 オーナーの決定）: 添えた AI の画像の説明文から、頭を外して重なりを除き、新しい順に 5 件
import { describe, expect, it } from "vitest";
import { AI_ALT_PREFIX, MAX_RECENT_SCENES, recentScenesFrom } from "@/lib/ai/photo";

describe("recentScenesFrom", () => {
  it("「AI で作った画像。」で始まる説明文だけを、頭を外して新しい順に並べる", () => {
    expect(recentScenesFrom([`${AI_ALT_PREFIX}朝の光のカウンター`, "手で書いた説明", null, `${AI_ALT_PREFIX}  紙袋のパン  `])).toEqual(["朝の光のカウンター", "紙袋のパン"]);
  });

  it("同じ説明は 1 回だけ、空の説明は出さない", () => {
    expect(recentScenesFrom([`${AI_ALT_PREFIX}A`, `${AI_ALT_PREFIX}A`, AI_ALT_PREFIX, `${AI_ALT_PREFIX}B`])).toEqual(["A", "B"]);
  });

  it(`${MAX_RECENT_SCENES} 件まで`, () => {
    expect(recentScenesFrom(Array.from({ length: 9 }, (_, i) => `${AI_ALT_PREFIX}場面${i}`))).toHaveLength(MAX_RECENT_SCENES);
  });
});
