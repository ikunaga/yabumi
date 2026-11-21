// ロードマップの上の数字のカード（2026-11-21 オーナーの指摘「これって何の数字？」）。数字の単位と、見込みを出すまでの日数
import { describe, expect, it } from "vitest";
import { progressOf } from "@/lib/goals/load";
import { GOAL_METRICS, type Goal } from "@/lib/goals/schema";
import { METRIC_UNIT, PROJECT_MIN_DAYS } from "@/lib/goals/view";

const goal = { id: "g", projectId: "p", statement: "", metric: "link_clicks", action: null, sns: null, target: 30, startsOn: "2026-11-02", endsOn: "2027-01-24", status: "active", provisional: false } as unknown as Goal;

describe("数字のカード", () => {
  it("どの数字にも単位がある（売上は円を formatMetric が付けるので空）", () => {
    for (const m of GOAL_METRICS) expect(m === "revenue" ? METRIC_UNIT[m] === "" : METRIC_UNIT[m].length > 0, m).toBe(true);
    expect(METRIC_UNIT.link_clicks).toBe("回");
  });

  it(`見込みは、数え始めて ${PROJECT_MIN_DAYS} 日たってから（それまでは「あと n 日数えると出ます」）`, () => {
    // 11/2 から 6 日（11/7 まで）数えた: まだ出さない
    expect(progressOf(goal, { value: 5, countedThrough: "2026-11-07", available: true }, "2026-11-08")).toMatchObject({ projected: null, countedDays: 6 });
    // 7 日: 出す（1 日あたり 1 回 × 84 日）
    expect(progressOf(goal, { value: 7, countedThrough: "2026-11-08", available: true }, "2026-11-09")).toMatchObject({ projected: 84, countedDays: 7 });
  });
});
