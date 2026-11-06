// AI と相談の会話の区切り（wrap_up）と、長くなったときの勧め（docs/architecture.md の 4.23）
import { describe, expect, it } from "vitest";
import { nextWeekItemsAdopted, type ConsultMessage } from "@/lib/ai/consult";
import { consultClosedText } from "@/lib/ai/consult-closed";
import { CONSULT_SYSTEM, SPLIT_SUGGEST_AFTER_TURNS, turnsLines } from "@/lib/ai/consult-prompt";
import { MAX_SUMMARY_LENGTH, normalizeConsultTurn, toWireConsultTurn } from "@/lib/ai/consult-schema";

const items = (weeks: number[]) => JSON.stringify({ items: weeks.map((week, i) => ({ title: `やること ${i}`, detail: "", week, kpi: null, target: null, kind: "post" })) });
const opt = (title: string, value_json: string) => ({ title, summary: "", pros: [], cons: [], value_json });

describe("区切り（wrap_up）の読み取り", () => {
  it("区切りの返事は、まとめを 1 行にして読み、choices は捨てる", () => {
    const t = normalizeConsultTurn({ message: "今回の振り返りはここまでです。", choices: ["次は？"], proposal: null, wrap_up: { summary: " 来週は\n2 本書く " } });
    expect(t).toMatchObject({ choices: [], proposal: null, wrapUp: { summary: "来週は 2 本書く" }, proposalProblem: null });
  });

  it("案が出ているときは区切らない（決めることが残っている）", () => {
    const t = normalizeConsultTurn({
      message: "案です。",
      choices: [],
      proposal: { kind: "roadmap_items", options: [opt("A", items([1])), opt("B", items([1, 1]))], recommended: 0, reason: "" },
      wrap_up: { summary: "まとめ" },
    });
    expect(t?.wrapUp).toBeUndefined();
    expect(t?.proposal?.options).toHaveLength(2);
  });

  it("wrap_up がない返事・null は、区切らない返事として読む", () => {
    expect(normalizeConsultTurn({ message: "はい。", choices: ["a"], proposal: null })).toMatchObject({ choices: ["a"], proposal: null });
    expect(normalizeConsultTurn({ message: "はい。", choices: [], proposal: null, wrap_up: null })?.wrapUp).toBeUndefined();
  });

  it("まとめは上限で切る", () => {
    const t = normalizeConsultTurn({ message: "ここまでです。", choices: [], proposal: null, wrap_up: { summary: "あ".repeat(500) } });
    expect(t?.wrapUp?.summary).toHaveLength(MAX_SUMMARY_LENGTH);
    expect(t?.wrapUp?.summary.endsWith("…")).toBe(true);
  });

  it("履歴として AI に渡すときも、区切ったことを wrap_up で伝える（前の返事は null）", () => {
    expect(toWireConsultTurn({ message: "ここまでです。", choices: [], proposal: null, wrapUp: { summary: "決めた" } })).toMatchObject({ wrap_up: { summary: "決めた" } });
    expect(toWireConsultTurn({ message: "はい。", choices: [], proposal: null })).toMatchObject({ wrap_up: null });
  });

  it("指示に、会話ごとのゴールと区切り方がある", () => {
    expect(CONSULT_SYSTEM).toContain("# 会話の区切り");
    expect(CONSULT_SYSTEM).toContain("振り返り: 次の一手（来週のやること）を採用した");
    expect(CONSULT_SYSTEM).toContain("1 か月の振り返り: 次の 1 か月の目標と週の本数（milestone）を採用した");
    expect(CONSULT_SYSTEM).toContain("目標の振り返り: 次の目標（kgi）か「期限まで続ける」を採用した");
    expect(CONSULT_SYSTEM).toContain("「わかった」「ありがとう」");
    expect(CONSULT_SYSTEM).toContain("今回の〇〇はここまでです");
    expect(CONSULT_SYSTEM).toContain("choices は空、proposal は null");
  });
});

describe("長くなったときの勧め", () => {
  it("往復の数を渡し、20 往復を過ぎた 1 回（21 回目）だけ、新しい相談に分けるよう勧めさせる", () => {
    expect(SPLIT_SUGGEST_AFTER_TURNS).toBe(20);
    expect(turnsLines(20)).toEqual(["この会話の往復: 20 回目"]);
    expect(turnsLines(21)).toEqual(["この会話の往復: 21 回目", "この返事で一度だけ、新しい相談に分けるよう勧める（話が広がってきたため）"]);
    expect(turnsLines(22)).toEqual(["この会話の往復: 22 回目"]);
    expect(turnsLines(undefined)).toEqual([]);
    expect(CONSULT_SYSTEM).toContain("話が広がってきたので、新しい相談に分けましょう");
  });
});

describe("終えたあとの知らせ", () => {
  it("決まった文だけを出す。件数は 1〜99 の数だけ読む", () => {
    expect(consultClosedText("consult_closed", undefined)).toBe("相談を終えました。");
    expect(consultClosedText("consult_closed", "3")).toBe("相談を終えました。来週のやることに 3 件入れました。");
    expect(consultClosedText("consult_closed", "0")).toBe("相談を終えました。");
    expect(consultClosedText("consult_closed", "<b>")).toBe("相談を終えました。");
    expect(consultClosedText("consult_closed", "100")).toBe("相談を終えました。");
    expect(consultClosedText("saved", "3")).toBeNull();
    // 振り返りのやることを済みにしたとき（名前はサーバーが DB から読んだもの）・済みにできなかったとき
    expect(consultClosedText("consult_closed", "2", { title: "4 週間の振り返り" })).toBe("相談を終えました。『4 週間の振り返り』を済みにしました。来週のやることに 2 件入れました。");
    expect(consultClosedText("consult_closed", undefined, { title: "数字を見る" })).toBe("相談を終えました。『数字を見る』を済みにしました。");
    expect(consultClosedText("consult_closed", "1", "many")).toBe("相談を終えました。来週のやることに 1 件入れました。今週の振り返りのやることが 2 つ以上あるので、ロードマップで済みにしてください。");
  });

  it("来週のやることの数は、採用した案の week 1 のやることだけを数える", () => {
    const proposal = (weeksA: number[], weeksB: number[]) => normalizeConsultTurn({ message: "案", choices: [], proposal: { kind: "roadmap_items", options: [opt("A", items(weeksA)), opt("B", items(weeksB))], recommended: 0, reason: "" } })!;
    const { proposalProblem: _a, ...p1 } = proposal([0, 1, 1], [1]);
    const { proposalProblem: _b, ...p2 } = proposal([1], [2]);
    void _a;
    void _b;
    const history = [
      { id: "1", role: "assistant", content: { ...p1, adopted: [0] }, created_at: "" },
      { id: "2", role: "assistant", content: { ...p2, adopted: [] }, created_at: "" },
    ] as ConsultMessage[];
    expect(nextWeekItemsAdopted(history)).toBe(2);
  });
});
