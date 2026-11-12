import { describe, expect, it } from "vitest";
import { currentStepIndex, listNextStep, nowBandKind, STEPS, stepHref, weekTodoPhase, type StepState, type WeekTodoCounts } from "@/lib/projects/next-step";

const none: StepState = { planDone: false, connectedSnsCount: 0, hasPublished: false, hasRoadmap: false };
const step = (planDone: boolean, connectedSnsCount: number) => STEPS[currentStepIndex({ ...none, planDone, connectedSnsCount })].key;

describe("いまやること", () => {
  it("設計 → SNS をつなぐ → 最初の投稿 の順に進む", () => {
    expect(step(false, 0)).toBe("plan");
    expect(step(true, 0)).toBe("connect");
    expect(step(true, 1)).toBe("firstPost");
  });

  it("SNS を先につないでいても、設計が済んでいなければ設計を勧める", () => {
    expect(step(false, 1)).toBe("plan");
  });

  it("最初の投稿を送ったら、目標とロードマップ。ロードマップができたら、すべて済み（今週のやることを出す）", () => {
    expect(STEPS[currentStepIndex({ ...none, planDone: true, connectedSnsCount: 1 })].key).toBe("firstPost");
    expect(STEPS[currentStepIndex({ planDone: true, connectedSnsCount: 1, hasPublished: true, hasRoadmap: false })].key).toBe("roadmap");
    expect(currentStepIndex({ planDone: true, connectedSnsCount: 1, hasPublished: true, hasRoadmap: true })).toBe(STEPS.length);
  });

  it("ボタンの行き先", () => {
    expect(stepHref("roadmap", "p")).toBe("/projects/p/roadmap");
    expect(stepHref("plan", "p")).toBe("/projects/p/plan");
    expect(stepHref("connect", "p")).toBe("/projects/p/edit#sns");
    expect(stepHref("firstPost", "p")).toBe("/projects/p/compose");
  });

  it("どの段階も押せる（準備中にしない）", () => {
    expect(STEPS.every((s) => s.available)).toBe(true);
  });
});

// プロジェクト一覧の「次にやること」（2026-10-22 の不具合: 投稿済みでも、いつも「最初の投稿をつくる」になっていた）
describe("一覧の次にやること", () => {
  const label = (over: Partial<StepState & { thisWeek: WeekTodoCounts }>) => listNextStep({ ...none, thisWeek: { open: 0, finished: 0 }, ...over }).label;
  const done = { planDone: true, connectedSnsCount: 1, hasPublished: true, hasRoadmap: true };

  it("済んだ段階ごとに変わる", () => {
    expect(label({})).toBe("アカウントを設計する");
    expect(label({ planDone: true })).toBe("SNS をつなぐ");
    expect(label({ planDone: true, connectedSnsCount: 2 })).toBe("最初の投稿をつくる");
    expect(label({ planDone: true, connectedSnsCount: 2, hasPublished: true })).toBe("目標とロードマップ");
  });

  it("投稿済みでロードマップもあれば、最初の投稿ではなく今週のやること（まだのものの数）", () => {
    expect(label({ ...done, thisWeek: { open: 2, finished: 1 } })).toBe("今週のやること あと 2 件");
    expect(listNextStep({ ...done, thisWeek: { open: 0, finished: 0 } }).stepIndex).toBe(STEPS.length);
  });

  // 2026-11-12 オーナーの指摘「今週のやることおわってるのにプロジェクト一覧に反映されない」: 済んだ週も、決めていない週と同じ「今週のやることを見る」だった
  it("今週のやることが全部済んだら「済みました」、まだ決めていなければ「決める」（概要の帯と同じ分け方）", () => {
    expect(label({ ...done, thisWeek: { open: 0, finished: 3 } })).toBe("✓ 今週のやることは済みました");
    expect(label({ ...done, thisWeek: { open: 0, finished: 0 } })).toBe("今週のやることを決める");
  });

  it("ロードマップを先に作っていても、投稿していなければ最初の投稿", () => {
    expect(label({ planDone: true, connectedSnsCount: 1, hasRoadmap: true, thisWeek: { open: 3, finished: 0 } })).toBe("最初の投稿をつくる");
  });
});

describe("今週のやることの段階（一覧と概要の帯で同じ）", () => {
  it("まだのものがあれば open、全部済んだら done、ひとつもなければ none", () => {
    expect(weekTodoPhase({ open: 1, finished: 4 })).toBe("open");
    expect(weekTodoPhase({ open: 0, finished: 1 })).toBe("done");
    expect(weekTodoPhase({ open: 0, finished: 0 })).toBe("none");
  });
});

describe("概要の「いまやること」の帯", () => {
  it("最初の 4 段階が残っていれば、いつもその段（GitHub をつなぐ案内は帯にしない）", () => {
    expect(nowBandKind({ stepIndex: 0, cycleEnded: false })).toBe("step");
    expect(nowBandKind({ stepIndex: 3, cycleEnded: true })).toBe("step");
  });
  it("4 段階が済んだら、1 か月の区切り、そうでなければ今週のやること", () => {
    expect(nowBandKind({ stepIndex: STEPS.length, cycleEnded: true })).toBe("cycle_ended");
    expect(nowBandKind({ stepIndex: STEPS.length, cycleEnded: false })).toBe("this_week");
  });
});
