// 目標に届かない見込みの判定と、AI なしの見直しの案（src/lib/goals/risk.ts。2026-11-19 オーナーの決定:
// 数え始めて 14 日以上、見込み ÷ 目標が 1 未満は「届かないかも」、0.7 未満は「このままでは届かない」）
import { describe, expect, it } from "vitest";
import { progressOf } from "@/lib/goals/load";
import { goalRisk, MAX_EXTEND_WEEKS, paceText, perWeekText, restateTarget, reviseChoices, RISK_MIN_DAYS, RISK_OFF_RATIO } from "@/lib/goals/risk";
import type { Goal } from "@/lib/goals/schema";

// 12 週（84 日）の予約 20 件の目標。11/2 から
const goal = (over: Partial<Goal> = {}): Goal =>
  ({
    id: "g1",
    projectId: "p1",
    statement: "3 か月で予約を 20 件にする",
    metric: "outcomes",
    action: "booking",
    sns: null,
    target: 20,
    startsOn: "2026-11-02",
    endsOn: "2027-01-24",
    status: "active",
    provisional: false,
    ...over,
  }) as Goal;

// 数えた最後の日までに value。today は数えた最後の日の次の日
const progress = (g: Goal, value: number, countedThrough: string, today: string) => progressOf(g, { value, countedThrough, available: true }, today)!;

describe("届かない見込みの判定", () => {
  it("決めたしきい値の値", () => {
    expect(RISK_MIN_DAYS).toBe(14);
    expect(RISK_OFF_RATIO).toBe(0.7);
  });

  it("数え始めて 14 日たつまでは判定しない", () => {
    const g = goal();
    // 13 日で 0 件（見込み 0）でも、まだ出さない
    expect(goalRisk(g, progress(g, 0, "2026-11-14", "2026-11-15"))).toBeNull();
    expect(goalRisk(g, progress(g, 0, "2026-11-15", "2026-11-16"))?.level).toBe("off");
  });

  it("見込み ÷ 目標が 1 未満は「届かないかも」、0.7 未満は「このままでは届かない」、1 以上は出さない", () => {
    const g = goal();
    // 28 日で 6 件 → 84 日で 18 件（0.9）
    expect(goalRisk(g, progress(g, 6, "2026-11-29", "2026-11-30"))?.level).toBe("maybe");
    // 28 日で 4 件 → 12 件（0.6）
    expect(goalRisk(g, progress(g, 4, "2026-11-29", "2026-11-30"))?.level).toBe("off");
    // 28 日で 7 件 → 21 件（1.05）
    expect(goalRisk(g, progress(g, 7, "2026-11-29", "2026-11-30"))).toBeNull();
  });

  it("届くのに要る 1 週あたりの数（切り上げ）と、いまの週のペースを出す", () => {
    const g = goal();
    const r = goalRisk(g, progress(g, 4, "2026-11-29", "2026-11-30"))!;
    // 残り 55 日（11/30 から 1/24、今日を含まない）で 16 件 → 1 週あたり 2.03… → 3
    expect(r.daysLeft).toBe(55);
    expect(r.needPerWeek).toBe(3);
    expect(r.nowPerWeek).toBe(1);
    expect(r.projected).toBe(12);
    expect(paceText("outcomes", r)).toBe("届くには週 3 件のペースが要ります。いまは週 1 件です");
  });

  it("1 週あたりの数は、1 未満なら「2 週に 1 件ほど」と整数で読める形にする（「週 0.5 件」にしない）", () => {
    expect(perWeekText("outcomes", 2)).toBe("週 2 件");
    expect(perWeekText("outcomes", 1.5)).toBe("週 1.5 件");
    expect(perWeekText("outcomes", 0.5)).toBe("2 週に 1 件ほど");
    expect(perWeekText("posts", 0.3)).toBe("3 週に 1 本ほど");
    expect(perWeekText("link_clicks", 0.9)).toBe("週 1 回ほど");
    expect(perWeekText("outcomes", 0)).toBe("週 0 件");
  });

  it("数えていない・仮の KGI・投稿の本数・届いた・期限が来た・見込みを出せない数字（売上）では出さない", () => {
    const g = goal();
    expect(goalRisk(g, progressOf(g, { value: 0, countedThrough: null, available: false }, "2026-11-30"))).toBeNull();
    expect(goalRisk(goal({ provisional: true }), progress(goal(), 1, "2026-11-29", "2026-11-30"))).toBeNull();
    expect(goalRisk(goal({ metric: "posts" }), progress(goal({ metric: "posts" }), 1, "2026-11-29", "2026-11-30"))).toBeNull();
    expect(goalRisk(g, progress(g, 20, "2026-11-29", "2026-11-30"))).toBeNull();
    expect(goalRisk(g, progress(g, 5, "2027-01-24", "2027-01-25"))).toBeNull();
    const rev = goal({ metric: "revenue", action: null, target: 100000 });
    expect(goalRisk(rev, progress(rev, 1000, "2026-11-29", "2026-11-30"))).toBeNull();
    expect(goalRisk(goal({ status: "expired" }), progress(g, 1, "2026-11-29", "2026-11-30"))).toBeNull();
  });
});

describe("AI なしの見直しの案", () => {
  it("いまの見込みまで下げる案と、いまのペースで届くまで期限をのばす案", () => {
    const g = goal();
    const r = goalRisk(g, progress(g, 4, "2026-11-29", "2026-11-30"))!;
    const [lower, extend] = reviseChoices(g, r);
    expect(lower).toEqual({ kind: "lower", target: 12 });
    // 週 1 のペースで残り 16 件は 16 週。残りは約 7.9 週なので、9 週のばす
    expect(extend).toEqual({ kind: "extend", weeks: 9, endsOn: "2027-03-28", reachable: true });
  });

  it("12 週のばしても届かないときは 12 週の案に「届かない」を付ける。ペースが 0 なら期限の案は出さない", () => {
    const g = goal();
    const slow = goalRisk(g, progress(g, 1, "2026-11-29", "2026-11-30"))!;
    const extend = reviseChoices(g, slow).find((c) => c.kind === "extend");
    expect(extend).toMatchObject({ weeks: MAX_EXTEND_WEEKS, reachable: false });
    const zero = goalRisk(g, progress(g, 0, "2026-11-29", "2026-11-30"))!;
    expect(reviseChoices(g, zero).map((c) => c.kind)).toEqual(["lower"]);
    // 見込み 0 でも、いまの数より 1 は上にする
    expect(reviseChoices(g, zero)[0]).toEqual({ kind: "lower", target: 1 });
  });

  it("目標の文の数字は、同じ数字がちょうど 1 か所のときだけ置き換える", () => {
    expect(restateTarget("3 か月で予約を 20 件にする", 20, 12)).toBe("3 か月で予約を 12 件にする");
    expect(restateTarget("売上を 100,000 円にする", 100000, 60000)).toBe("売上を 60,000 円にする");
    // 2 か所あるときと、ないときはそのまま
    expect(restateTarget("20 日までに 20 件", 20, 12)).toBe("20 日までに 20 件");
    expect(restateTarget("予約をふやす", 20, 12)).toBe("予約をふやす");
    // 別の数字の一部は置き換えない
    expect(restateTarget("120 件のうち 20 件", 20, 12)).toBe("120 件のうち 12 件");
  });
});
