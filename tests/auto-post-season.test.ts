import { describe, expect, it } from "vitest";
import { buildAutoPostRequest } from "@/lib/auto-post/prompt";
import { dueDayText, seasonOf } from "@/lib/auto-post/season";

// 自動の投稿の AI に、送る日と季節を渡す（docs/design/auto-sample-image.md の 12.。2026-11-21 の本物の確かめで「季節の話から入る」が効かなかった直し）
describe("送る日と季節（日本時間・日本の暦）", () => {
  it("月ごとの季節", () => {
    const at = (m: number) => new Date(`2026-${String(m).padStart(2, "0")}-15T03:00:00Z`);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => seasonOf(at(m)))).toEqual(["真冬", "晩冬", "早春", "春", "晩春", "初夏（梅雨のころ）", "夏", "晩夏", "初秋", "秋", "晩秋", "初冬"]);
  });
  it("日本時間で数える（UTC の夜 15 時は、日本では次の日）", () => {
    expect(dueDayText(new Date("2026-11-23T15:00:00Z"))).toBe("11 月 24 日（火）。季節は晩秋（日本）");
    expect(dueDayText(new Date("2026-11-30T15:30:00Z"))).toBe("12 月 1 日（火）。季節は初冬（日本）");
  });
});

describe("AI に渡す指示", () => {
  it("送る日（月・日・曜日）と季節を、材料の前に渡す。年は書かない", () => {
    const text = buildAutoPostRequest({ context: "", material: "メモ", instructions: ["季節の話から入る"], recentBodies: [], dueAt: new Date("2026-11-24T10:00:00Z") }).messages[0].content;
    const s = JSON.stringify(text);
    expect(s).toContain("# 送る日\\n11 月 24 日（火）。季節は晩秋（日本）");
    expect(s.indexOf("# 送る日")).toBeLessThan(s.indexOf("# この回の材料"));
    expect(s).not.toContain("2026");
  });
});
