// AI との会話の組み立て、費用の見積もり、上限の期間。本物の API は呼ばない
import { describe, expect, it } from "vitest";
import { aiLimitsFromEnv, jstPeriodStarts } from "@/lib/ai/limits";
import { buildCoachRequest, userContentToText, type StoredMessage } from "@/lib/ai/plan-coach";
import { coachContextMessage, PLAN_COACH_SYSTEM } from "@/lib/ai/plan-coach-prompt";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { normalizePlan } from "@/lib/plan/schema";

const ctx = {
  project: { name: "かけいぼ日和", description: "レシートを撮るだけの家計簿", appStoreUrl: null, playStoreUrl: null },
  plan: normalizePlan({ goal: { goalType: "awareness" } }, "28 歳の会社員"),
  sources: { goal: "ai" as const },
  focus: null,
};

const history: StoredMessage[] = [
  { id: "1", role: "user", content: { kind: "start", focus: null }, created_at: "" },
  { id: "2", role: "assistant", content: { message: "目的は？", choices: ["知ってもらう"], proposal: null, adopted: null }, created_at: "" },
  { id: "3", role: "user", content: { kind: "text", text: "知ってもらいたい" }, created_at: "" },
];

describe("会話の組み立て", () => {
  it("システムプロンプトは固定で、キャッシュの印が付く", () => {
    const req = buildCoachRequest(history, ctx);
    expect(req.system).toEqual([{ type: "text", text: PLAN_COACH_SYSTEM, cache_control: { type: "ephemeral" } }]);
    // 日付などの変わる値を入れない（キャッシュが効かなくなる）
    expect(PLAN_COACH_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("最後の利用者の発言にキャッシュの印を付け、いまの状況はその後ろにシステムメッセージで置く", () => {
    const req = buildCoachRequest(history, ctx);
    const roles = req.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "system"]);
    const lastUser = req.messages[2].content as { text: string; cache_control?: unknown }[];
    expect(lastUser[0]).toMatchObject({ text: "知ってもらいたい", cache_control: { type: "ephemeral" } });
    // 前の発言には印を付けない（印は 4 つまで）
    expect((req.messages[0].content as { cache_control?: unknown }[])[0].cache_control).toBeUndefined();
    expect(req.messages[3].content).toContain("かけいぼ日和");
  });

  it("AI の前の返事は、構造化出力と同じ JSON で渡す（採用の印は渡さない）", () => {
    const req = buildCoachRequest(history, ctx);
    const text = (req.messages[1].content as { text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ message: "目的は？", choices: ["知ってもらう"], proposal: null });
  });

  it("いまの状況に、プロジェクトの情報と設計の決まり具合を入れる", () => {
    const m = coachContextMessage(ctx);
    expect(m).toContain("レシートを撮るだけの家計簿");
    expect(m).toContain("決定（AI の案を採用）");
    expect(m).toContain("28 歳の会社員");
  });

  it("利用者の操作を、AI に伝わる文にする", () => {
    expect(userContentToText({ kind: "start", focus: "cadence" })).toContain("頻度と SNS ごとの役割");
    expect(userContentToText({ kind: "adopt", messageId: "x", optionIndex: 0, section: "pillars", title: "開発日記" })).toContain("採用して保存しました");
  });
});

describe("費用", () => {
  it("Opus 5.5 の料金で見積もる（キャッシュの書き込みは 1.25 倍、読み込みは 0.2 ドル）", () => {
    const cost = estimateCostUsd("claude-opus-5-5", { inputTokens: 1_000_000, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(4 + 5 + 0.2 + 20);
  });

  it("知らないモデルは高めに見積もる", () => {
    expect(estimateCostUsd("unknown", { inputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 })).toBe(5);
  });
});

describe("上限", () => {
  it("既定値と、環境変数での上書き", () => {
    expect(aiLimitsFromEnv({})).toEqual({ userMonthlyUsd: 3, globalMonthlyUsd: 10, userDailyTurns: 60 });
    expect(aiLimitsFromEnv({ AI_USER_MONTHLY_BUDGET_USD: "1.5", AI_USER_DAILY_TURNS: "abc" }).userMonthlyUsd).toBe(1.5);
    expect(aiLimitsFromEnv({ AI_USER_DAILY_TURNS: "abc" }).userDailyTurns).toBe(60);
  });

  it("月と日の区切りは日本時間", () => {
    // 日本時間 2026-11-01 05:00 は UTC では 10-31 20:00
    const { monthStart, dayStart } = jstPeriodStarts(new Date("2026-10-31T20:00:00Z"));
    expect(monthStart.toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(dayStart.toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });
});
