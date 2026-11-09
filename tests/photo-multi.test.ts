// 画像を続けてつくる（オーナーの Notion の項目「1 枚目、2 枚目の作成の手順をわかりやすく」）: 2 枚目からを 1 枚目の縦横にそろえる
import { describe, expect, it } from "vitest";
import { TEMPLATE_SIZES, closestSize } from "@/lib/media/templates";

describe("1 枚目にいちばん近い縦横", () => {
  it("1 枚目と同じ比率なら、その枠", () => {
    for (const k of Object.keys(TEMPLATE_SIZES) as (keyof typeof TEMPLATE_SIZES)[]) expect(closestSize(TEMPLATE_SIZES[k].w, TEMPLATE_SIZES[k].h)).toBe(k);
  });
  it("AI の画像（928×1152 ほど）・スマホの写真（3:4）は縦 4:5、少し横長は正方形、16:9 に近い横長は横", () => {
    expect(closestSize(928, 1152)).toBe("portrait");
    expect(closestSize(3024, 4032)).toBe("portrait");
    expect(closestSize(1200, 1000)).toBe("square");
    expect(closestSize(1920, 1080)).toBe("landscape");
    expect(closestSize(1600, 1000)).toBe("landscape");
  });
});
