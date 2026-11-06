// AI と相談の目標の部分（段階 ③。docs/design/goals-model.md の 6.）: 「いまの状況」の目標の文、終えたときの知らせ、アカウント設計の相棒の指示。本物の AI は呼ばない
import { describe, expect, it } from "vitest";
import { consultClosedText } from "@/lib/ai/consult-closed";
import { goalContextLines, goalMetricLabel, type GoalContext } from "@/lib/ai/consult-goals";
import { PLAN_COACH_SYSTEM } from "@/lib/ai/plan-coach-prompt";

const base: GoalContext = { active: null, past: [], candidates: [] };
const active: NonNullable<GoalContext["active"]> = {
  statement: "3 か月で予約 30 件",
  metric: "outcomes",
  label: "予約（手で記録）",
  target: 30,
  startsOn: "2026-11-02",
  endsOn: "2027-01-24",
  provisional: false,
  legacyPosts: false,
  progress: { value: 4, countedThrough: "2026-11-05", available: true, projected: 21, daysLeft: 80 },
  milestones: [
    { seq: 1, startsOn: "2026-11-02", endsOn: "2026-11-29", target: 6, result: null, current: true },
    { seq: 2, startsOn: "2026-11-30", endsOn: "2026-12-27", target: 10, result: null, current: false },
  ],
  current: { value: 4, countedThrough: "2026-11-05", available: true },
  kpis: [{ label: "行き先へのクリック", perWeek: 15 }],
  actions: [{ sns: "instagram", perWeek: 2 }],
  review: null,
};

describe("いまの状況の目標", () => {
  it("KGI まだなら、そう書く。候補の数字が数えられるかを添える", () => {
    const lines = goalContextLines({ ...base, candidates: [{ metric: "outcomes", action: "booking", label: "予約（手で記録）", available: true, hasData: false }, { metric: "link_clicks", action: null, label: "行き先へのクリック", available: true, hasData: true }] });
    expect(lines).toContain("KGI: まだ決めていない");
    expect(lines).toContain("- 予約（手で記録）（metric: outcomes、action: booking）: 数えられるが、まだ記録がない");
    expect(lines).toContain("- 行き先へのクリック（metric: link_clicks）: 数えている");
  });

  it("KGI・進み具合（数えた最後の日と見込み）・中間の目標・KPI・行動の目標を書く", () => {
    const text = goalContextLines({ ...base, active }).join("\n");
    expect(text).toContain("KGI: 3 か月で予約 30 件（予約（手で記録） を 30、2026-11-02〜2027-01-24）");
    expect(text).toContain("KGI の進み具合: 4（2026-11-05 まで数えた） / 30、残り 80 日、このままのペースの見込み 21");
    expect(text).toContain("- 1 つ目 2026-11-02〜2026-11-29: 目標 6（いまの区切り。いまの数 4（2026-11-05 まで数えた））");
    expect(text).toContain("KPI の週の目標: 行き先へのクリック 週 15");
    expect(text).toContain("行動の目標（投稿の週の本数）: Instagram 週 2");
  });

  it("数えていない数字は推測させない。投稿の本数の KGI は成果の目標に替えるよう勧めさせる。期限・届いたことを書く", () => {
    const text = goalContextLines({ ...base, active: { ...active, legacyPosts: true, review: "ended", progress: { ...active.progress!, available: false } } }).join("\n");
    expect(text).toContain("数えていない（取り込み元をつないでいない。推測で語らない）");
    expect(text).toContain("成果の数字の KGI に替えるよう勧める");
    expect(text).toContain("KGI の期限が来た");
  });

  it("これまでの目標は、結果と状態（達成・期限切れ・期限の前に替えた）を書く", () => {
    const text = goalContextLines({ ...base, past: [{ statement: "3 か月で予約 20 件", label: "予約（手で記録）", metric: "outcomes", target: 20, result: 22, status: "achieved", startsOn: "2026-08-03", endsOn: "2026-10-25" }] }).join("\n");
    expect(text).toContain("- 3 か月で予約 20 件（予約（手で記録）、2026-08-03〜2026-10-25）: 達成、結果 22 / 20");
  });

  it("数字の名前（成果は種類、SNS は添える）", () => {
    expect(goalMetricLabel({ metric: "outcomes", action: "visit", sns: null })).toBe("来店（手で記録）");
    expect(goalMetricLabel({ metric: "followers", action: null, sns: "instagram" })).toBe("フォロワーの増え方（Instagram）");
    expect(goalMetricLabel({ metric: null, action: null, sns: null })).toBe("（まだ決めていない）");
  });
});

describe("目標の振り返りを終えたときの知らせ", () => {
  it("新しい目標を始めた（名前は DB から）・期限まで続ける", () => {
    expect(consultClosedText("consult_closed", undefined, null, { started: "3 か月で予約 40 件" })).toBe("相談を終えました。新しい目標『3 か月で予約 40 件』を始めました。");
    expect(consultClosedText("consult_closed", undefined, null, "kept")).toBe("相談を終えました。いまの目標を期限まで続けます。");
    expect(consultClosedText("consult_closed", undefined)).toBe("相談を終えました。");
  });
});

describe("アカウント設計の相棒の指示", () => {
  it("週の回数だけを決め、目標の文に回数を書く決まりはない。見た人にしてほしいことが 3 か月の目標の数字になると添える", () => {
    expect(PLAN_COACH_SYSTEM).not.toContain("4 週間で X に 8 回");
    expect(PLAN_COACH_SYSTEM).toContain("決めるのは weekly だけ");
    expect(PLAN_COACH_SYSTEM).toContain("3 か月の目標（KGI）の数字になる");
  });
});
