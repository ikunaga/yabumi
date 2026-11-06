// 目標の画面（段階 ②。docs/design/goals-model.md の 5.）: 数字の名前と選択肢、概要の帯の決め方（目標の振り返り・区切りとの重なり）、
// 区切りから伴走の 1 か月を出す、数字のカードの KPI、アカウント設計の週の回数の欄の値
import { describe, expect, it } from "vitest";
import { cycleFromMilestones } from "@/lib/coach/pace";
import { cycleMergedIntoGoal, formatMetric, goalReviewOf, kpiCardKeys, metricChoices, metricChoiceValue, metricLabel, notCountedText, withGoalWeekly } from "@/lib/goals/view";
import { nowBandKind, STEPS } from "@/lib/projects/next-step";

describe("数字の名前と選択肢", () => {
  it("成果は種類を、SNS の数字は SNS を添える。クリックはアプリならストアへのクリック", () => {
    expect(metricLabel({ metric: "outcomes", action: "booking", sns: null })).toBe("成果（予約）");
    expect(metricLabel({ metric: "followers", action: null, sns: "instagram" })).toBe("フォロワーの増え方（Instagram）");
    expect(metricLabel({ metric: "posts", action: null, sns: null })).toBe("投稿した回数（すべての SNS）");
    expect(metricLabel({ metric: "link_clicks", action: null, sns: null }, "app")).toBe("ストアへのクリック");
    expect(metricLabel({ metric: "link_clicks", action: null, sns: null }, "shop")).toBe("行き先へのクリック");
    expect(formatMetric("revenue", 12345.6)).toBe("12,346 円");
    expect(formatMetric("outcomes", 30)).toBe("30");
  });

  it("KGI と KPI の選択肢に投稿の本数はない。成果は種類ごと。アプリでなければストアの数字は出さない（選んでいるものは残す）", () => {
    const shop = metricChoices("shop").map((c) => c.value);
    expect(shop).not.toContain("posts");
    expect(shop).toEqual(expect.arrayContaining(["link_clicks", "outcomes:booking", "outcomes:visit", "followers", "views"]));
    expect(shop).not.toContain("downloads");
    expect(metricChoices("shop", ["downloads"]).find((c) => c.value === "downloads")?.label).toContain("アプリのときだけ");
    expect(metricChoices("app").map((c) => c.value)).toEqual(expect.arrayContaining(["downloads", "store_page_views", "revenue"]));
    expect(metricChoiceValue({ metric: "outcomes", action: "inquiry" })).toBe("outcomes:inquiry");
    expect(metricChoiceValue({ metric: "views", action: null })).toBe("views");
  });

  it("数えていない数字は、何をすると数えるかを出す", () => {
    expect(notCountedText("outcomes")).toContain("成果を記録");
    expect(notCountedText("downloads", "shop")).toContain("アプリ");
    expect(notCountedText("downloads", "app")).toContain("App Store");
  });
});

describe("概要の帯", () => {
  const done = STEPS.length;
  it("目標の振り返りは 1 か月の区切りより先。区切りが目標の振り返りにまとまるときは、区切りの帯を出さない", () => {
    expect(nowBandKind({ stepIndex: 0, cycleEnded: true, goalReview: true })).toBe("step");
    expect(nowBandKind({ stepIndex: done, cycleEnded: true, goalReview: true })).toBe("goal_review");
    expect(nowBandKind({ stepIndex: done, cycleEnded: true, goalReview: false })).toBe("cycle_ended");
    expect(nowBandKind({ stepIndex: done, cycleEnded: true, goalReview: false, cycleMerged: true })).toBe("this_week");
    expect(nowBandKind({ stepIndex: done, cycleEnded: false })).toBe("this_week");
  });

  it("届いたあと、その目標の振り返りを一度終えていれば、期限が来るまで出さない", () => {
    expect(goalReviewOf("reached", false)).toBe("reached");
    expect(goalReviewOf("reached", true)).toBeNull();
    expect(goalReviewOf("ended", true)).toBe("ended");
    expect(goalReviewOf(null, false)).toBeNull();
  });

  it("目標の期限が、終わった区切りの最後の日から 7 日以内なら、区切りは目標の振り返りにまとめる", () => {
    const goal = { metric: "outcomes" as const, endsOn: "2027-01-24" };
    expect(cycleMergedIntoGoal(goal, "2027-01-24")).toBe(true);
    expect(cycleMergedIntoGoal(goal, "2027-01-17")).toBe(true);
    expect(cycleMergedIntoGoal(goal, "2027-01-16")).toBe(false);
    expect(cycleMergedIntoGoal({ metric: null, endsOn: null }, "2027-01-24")).toBe(false);
    expect(cycleMergedIntoGoal(goal, null)).toBe(false);
  });
});

describe("区切り → 伴走の 1 か月", () => {
  const ms = [
    { startsOn: "2026-11-02", endsOn: "2026-11-29", settledAt: null },
    { startsOn: "2026-11-30", endsOn: "2026-12-27", settledAt: null },
  ];
  it("今日を含む区切りと、何週目か", () => {
    expect(cycleFromMilestones(ms, "2026-11-10")).toEqual({ startedOn: "2026-11-02", endsOn: "2026-11-29", weekIndex: 2, ended: false });
  });

  it("過ぎたのにまだ振り返っていない区切りがあれば、次の区切りが始まっていても「終わった」", () => {
    expect(cycleFromMilestones(ms, "2026-12-01")).toMatchObject({ startedOn: "2026-11-02", ended: true });
    const settled = [{ ...ms[0], settledAt: "2026-11-30T00:00:00Z" }, ms[1]];
    expect(cycleFromMilestones(settled, "2026-12-01")).toMatchObject({ startedOn: "2026-11-30", ended: false, weekIndex: 1 });
  });

  it("区切りがなければ null。期限で短くなった区切りは、その週の数まで", () => {
    expect(cycleFromMilestones([], "2026-11-10")).toBeNull();
    expect(cycleFromMilestones([{ startsOn: "2026-11-02", endsOn: "2026-11-15", settledAt: null }], "2026-11-14")).toMatchObject({ weekIndex: 2, ended: false });
  });
});

describe("数字のカードと週の回数の欄", () => {
  it("いまの目標の KPI があればそれ（その種類で出せるもの）、なければ前の選び方", () => {
    expect(kpiCardKeys([{ metric: "link_clicks" }, { metric: "outcomes" }, { metric: "outcomes" }], "shop", ["posts"])).toEqual(["link_clicks", "outcomes"]);
    expect(kpiCardKeys([{ metric: "downloads" }], "shop", ["posts", "link_clicks"])).toEqual(["posts", "link_clicks"]);
    expect(kpiCardKeys([], "app", ["views"])).toEqual(["views"]);
  });

  it("週の回数と数え始めは、行動の目標と区切りで置き換える（JSON の前の値は使わない）", () => {
    const fm = { goal: "前の文", metrics: "", kpis: [], weekly: { x: 9 }, startedOn: "2026-09-07" };
    const actions = [
      { role: "action" as const, sns: "x" as const, perWeek: 3 },
      { role: "action" as const, sns: null, perWeek: 5 },
      { role: "action" as const, sns: "instagram" as const, perWeek: 2 },
    ];
    expect(withGoalWeekly(fm, actions, "2026-11-02")).toEqual({ goal: "前の文", metrics: "", kpis: [], weekly: { x: 3, instagram: 2 }, startedOn: "2026-11-02" });
    expect(withGoalWeekly(fm, [], null)).toMatchObject({ weekly: {}, startedOn: null });
  });
});
