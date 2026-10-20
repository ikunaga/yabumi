// 「投稿のネタを出す」画面の 3 つのステップ（src/lib/ideas/steps.ts）: 始めるステップ、印から移れるステップ、ネタがないときの ③
import { describe, expect, it } from "vitest";
import { canGoIdeaStep, initialIdeaStep, visibleIdeaStep } from "@/lib/ideas/steps";

describe("始めるステップ", () => {
  it("はじめては ①、前に出したネタがあれば ③、ネタ帳でメモを選んできたら（ネタがあっても）②", () => {
    expect(initialIdeaStep({ hasThread: false, fromNotes: false })).toBe(1);
    expect(initialIdeaStep({ hasThread: true, fromNotes: false })).toBe(3);
    expect(initialIdeaStep({ hasThread: false, fromNotes: true })).toBe(2);
    expect(initialIdeaStep({ hasThread: true, fromNotes: true })).toBe(2);
  });
});

describe("移れるステップ", () => {
  it("①・② はいつでも、③ はネタを出したあとだけ", () => {
    expect(canGoIdeaStep(1, false)).toBe(true);
    expect(canGoIdeaStep(2, false)).toBe(true);
    expect(canGoIdeaStep(3, false)).toBe(false);
    expect(canGoIdeaStep(3, true)).toBe(true);
  });

  it("③ にいてもネタがなくなったら（会話を消したあと）① を出す", () => {
    expect(visibleIdeaStep(3, false)).toBe(1);
    expect(visibleIdeaStep(3, true)).toBe(3);
    expect(visibleIdeaStep(2, false)).toBe(2);
  });
});
