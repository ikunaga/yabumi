import { describe, expect, it } from "vitest";
import { currentStepIndex, STEPS, stepHref } from "@/lib/projects/next-step";

const step = (planDone: boolean, connectedSnsCount: number) => STEPS[currentStepIndex({ planDone, connectedSnsCount })].key;

describe("いまやること", () => {
  it("設計 → SNS をつなぐ → 最初の投稿 の順に進む", () => {
    expect(step(false, 0)).toBe("plan");
    expect(step(true, 0)).toBe("connect");
    expect(step(true, 1)).toBe("firstPost");
  });

  it("SNS を先につないでいても、設計が済んでいなければ設計を勧める", () => {
    expect(step(false, 1)).toBe("plan");
  });

  it("ボタンの行き先", () => {
    expect(stepHref("plan", "p")).toBe("/projects/p/plan");
    expect(stepHref("connect", "p")).toBe("/projects/p#sns");
    expect(stepHref("firstPost", "p")).toBe("/projects/p/compose");
  });

  it("どの段階も押せる（準備中にしない）", () => {
    expect(STEPS.every((s) => s.available)).toBe(true);
  });
});
