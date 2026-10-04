import { describe, expect, it } from "vitest";
import { checkTarget, displayLength, xWeightedLength } from "@/lib/sns";

describe("X の文字数", () => {
  it("半角は 1、日本語は 2 として数える", () => {
    expect(xWeightedLength("abc")).toBe(3);
    expect(xWeightedLength("あいう")).toBe(6);
    expect(xWeightedLength("v1.2 です")).toBe(9);
  });

  it("URL は長さに関係なく 23", () => {
    expect(xWeightedLength("https://apps.apple.com/jp/app/id1234567890")).toBe(23);
    expect(xWeightedLength("見て https://example.com")).toBe(4 + 1 + 23);
  });

  it("画面には全角換算（切り上げ）で出す", () => {
    expect(displayLength("x", "あいう")).toBe(3);
    expect(displayLength("x", "abc")).toBe(2);
  });

  it("全角 140 字ちょうどは OK、141 字は文字数オーバー", () => {
    expect(checkTarget("x", "あ".repeat(140)).issues).toEqual([]);
    expect(checkTarget("x", "あ".repeat(141)).issues).toEqual(["too_long"]);
  });
});

describe("SNS ごとの指摘", () => {
  it("Threads は 500 字まで", () => {
    expect(checkTarget("threads", "a".repeat(500)).issues).toEqual([]);
    expect(checkTarget("threads", "a".repeat(501)).issues).toEqual(["too_long"]);
  });

  it("絵文字は 1 字として数える（Threads）", () => {
    expect(displayLength("threads", "🎉🎉")).toBe(2);
  });

  it("Instagram は画像か動画が必要", () => {
    expect(checkTarget("instagram", "本文").issues).toEqual(["needs_image"]);
    expect(checkTarget("instagram", "本文", { images: 1, videos: 0 }).issues).toEqual([]);
  });

  it("TikTok と YouTube は動画が必要", () => {
    expect(checkTarget("tiktok", "本文").issues).toEqual(["needs_video"]);
    expect(checkTarget("youtube", "本文", { images: 3, videos: 0 }).issues).toEqual(["needs_video"]);
    expect(checkTarget("youtube", "本文", { images: 0, videos: 1 }).issues).toEqual([]);
  });

  it("Facebook は上限なし", () => {
    expect(checkTarget("facebook", "a".repeat(20000)).issues).toEqual([]);
  });

  it("空の本文は指摘する", () => {
    expect(checkTarget("threads", "  ").issues).toEqual(["empty"]);
  });
});
