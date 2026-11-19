// AI と相談の「目標の立て直し」（docs/design/goals-model.md の 13.2。2026-11-19 オーナーの決定: 責めないが、届かない見込みははっきり言う）。
// 「いまの状況」の届かない見込みの 1 行と立て直しの材料、指示の文の決まり、案の見出し、入口。本物の AI は呼ばない
import { describe, expect, it } from "vitest";
import { CONSULT_TOPICS } from "@/lib/ai/consult";
import { goalContextLines, goalRescueLines, type GoalContext } from "@/lib/ai/consult-goals";
import { CONSULT_SYSTEM, consultContextMessage, type ConsultContext } from "@/lib/ai/consult-prompt";
import { reviewHeadingOf, type ConsultProposal } from "@/lib/ai/consult-schema";
import { CONSULT_TOPIC_META, listedConsultTopics } from "@/lib/ai/consult-topics";
import { normalizePlan } from "@/lib/plan/schema";

const active: NonNullable<GoalContext["active"]> = {
  statement: "3 か月で予約 20 件",
  metric: "outcomes",
  label: "成果（予約）",
  target: 20,
  startsOn: "2026-11-02",
  endsOn: "2027-01-24",
  provisional: false,
  legacyPosts: false,
  progress: { value: 2, countedThrough: "2026-11-17", available: true, projected: 11, daysLeft: 66 },
  milestones: [],
  current: null,
  kpis: [],
  actions: [],
  review: null,
  risk: { level: "off", needPerWeek: 2, nowPerWeek: 0.9 },
};

describe("いまの状況の、届かない見込み", () => {
  it("届かない見込みのときは、どの相談でも 1 行を足す（このままでは届かない・届かないかも）", () => {
    const off = goalContextLines({ active, past: [], candidates: [] }).join("\n");
    expect(off).toContain("届かない見込み: このままでは届かない（見込みが目標の 7 割に届かない）。届くには残りで 1 週あたり 2、いまは週 0.9");
    const maybe = goalContextLines({ active: { ...active, risk: { level: "maybe", needPerWeek: 2, nowPerWeek: 1.8 } }, past: [], candidates: [] }).join("\n");
    expect(maybe).toContain("届かない見込み: 届かないかもしれない（見込みが目標に少し足りない）");
    const none = goalContextLines({ active: { ...active, risk: null }, past: [], candidates: [] }).join("\n");
    expect(none).not.toContain("届かない見込み");
  });

  it("立て直しの材料: 要るペース、直近 4 週の流れ、KPI と投稿の本数の実績 / 目標。数えていない数字は推測させない", () => {
    const text = goalRescueLines({
      metric: "outcomes",
      daysLeft: 66,
      needPerWeek: 2,
      nowPerWeek: 0.9,
      flow: [
        { label: "投稿した回数（すべての SNS）", total: 6 },
        { label: "閲覧数", total: null },
        { label: "行き先へのクリック", total: 40 },
        { label: "成果（予約）", total: 2 },
      ],
      kpis: [{ label: "行き先へのクリック", total: 40, target: 60 }],
      actions: [{ label: "投稿した回数（Threads）", total: 6, target: 8 }],
    });
    expect(text).toContain("届くのに要るペース: 残り 66 日で、1 週あたり 2（いまは週 0.9）");
    expect(text).toContain("直近 4 週の流れ（投稿 → 閲覧 → クリック → 成果。どこが細いかの見当に使う）:");
    expect(text).toContain("- 閲覧数: 数えていない（推測で語らない）");
    expect(text).toContain("- 行き先へのクリック: 40 / 60");
    expect(text).toContain("- 投稿した回数（Threads）: 6 / 8");
  });

  it("立て直しの材料は、その会話のときだけ「いまの状況」に入る", () => {
    const ctx: ConsultContext = {
      today: "2026-11-19",
      project: { name: "テストの教室", description: "", appStoreUrl: null, playStoreUrl: null, productType: "shop" },
      plan: normalizePlan(null, ""),
      connectedSns: [],
      manualSns: [],
      recentPosts: [],
      kpiNumbers: [],
      goals: { active, past: [], candidates: [] },
      roadmap: { items: [] },
    };
    expect(consultContextMessage(ctx)).not.toContain("# 目標の立て直し");
    expect(consultContextMessage({ ...ctx, goalRescue: "届くのに要るペース: …" })).toContain("# 目標の立て直し\n届くのに要るペース: …");
  });
});

describe("指示の文", () => {
  it("責めないが、届かない見込みは差を数字ではっきり言う（ぼかさない・大げさにしない）", () => {
    expect(CONSULT_SYSTEM).toContain("相手を責めない。「続けていること」をまず認める");
    expect(CONSULT_SYSTEM).toContain("「いまの状況」に「届かない見込み」があるときは、そのことと差の大きさを数字ではっきり言う");
    expect(CONSULT_SYSTEM).toContain("ぼかさない。大げさにもしない");
  });

  it("1 か月の振り返りでは、届かない見込みなら打ち手か見直しを必ず出す（前は「出してよい」・半分に届かないときだけ）", () => {
    expect(CONSULT_SYSTEM).toContain("③ の前に必ず、差を数字で言い、「打ち手を変える案」");
    expect(CONSULT_SYSTEM).not.toContain("出してよい。見直すのは、相手が望んだときか、見込みが KGI の半分に届かないとき");
  });

  it("ふだんの振り返りでも、届かない見込みなら最初に差を言う", () => {
    expect(CONSULT_SYSTEM).toContain("① の前に一言、届かない見込みと差を数字で言う");
  });

  it("立て直し: 差 → 詰まっている所の見当（投稿 → 閲覧 → クリック → 成果）→ 3 つの方向を choices で。最初の返事に proposal は出さない", () => {
    expect(CONSULT_SYSTEM).toContain("# 目標の立て直し（「いまの状況」に「目標の立て直し」があるとき）");
    expect(CONSULT_SYSTEM).toContain("最初の返事は、次の順に書き、proposal は出さない");
    expect(CONSULT_SYSTEM).toContain("直近 4 週の流れ（投稿 → 閲覧 → クリック → 成果）のどこが細いか");
    expect(CONSULT_SYSTEM).toContain("choices に出す:「やり方を変える」「投稿を少し増やす」「目標を見直す」");
    expect(CONSULT_SYSTEM).toContain("増やすのは 1 SNS につき週 1 まで");
    expect(CONSULT_SYSTEM).toContain("目標の立て直し: 選んだ方向の案（やること・週の本数・目標の見直し）を採用した");
  });
});

describe("入口と案の見出し", () => {
  it("立て直しは、ロードマップと概要からだけ始める入口（相談の一覧には出さない）。戻り先はロードマップ", () => {
    expect(CONSULT_TOPICS.goal_rescue).toContain("目標に届かない見込み");
    expect(CONSULT_TOPIC_META.goal_rescue.entryOnly).toBe(true);
    expect(CONSULT_TOPIC_META.goal_rescue.entry.back.path).toBe("roadmap");
    expect(listedConsultTopics()).not.toContain("goal_rescue");
  });

  it("立て直しの案の見出し", () => {
    const p = (kind: string) => ({ kind, options: [] }) as unknown as ConsultProposal;
    expect(reviewHeadingOf(p("roadmap_items"), "goal_rescue")).toBe("立て直しのやること");
    expect(reviewHeadingOf(p("action_targets"), "goal_rescue")).toBe("立て直しの週の本数");
    expect(reviewHeadingOf(p("revise_goal"), "goal_rescue")).toBe("目標の見直し");
    expect(reviewHeadingOf(p("roadmap_items"), "what_to_post")).toBeNull();
  });
});
