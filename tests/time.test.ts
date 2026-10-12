import { describe, expect, it } from "vitest";
import { addDays, addMonths, formatShort, fromInputValue, isYm, monthGrid, toInputValue, toYmd, weekOf, weekdayLabel, ymOf } from "@/lib/time";

describe("日本時間の扱い", () => {
  it("入力値を日本時間として ISO にし、戻せる", () => {
    const iso = fromInputValue("2026-10-14T20:00");
    expect(iso).toBe("2026-10-14T11:00:00.000Z");
    expect(toInputValue(iso)).toBe("2026-10-14T20:00");
  });

  it("不正な入力は null", () => {
    expect(fromInputValue("")).toBeNull();
    expect(fromInputValue("2026-10-14")).toBeNull();
  });

  it("日付の境目は日本時間で判定する（UTC では前日でも日本では当日）", () => {
    expect(toYmd(new Date("2026-10-13T15:30:00Z"))).toBe("2026-10-14");
  });

  it("週は月曜はじまり", () => {
    expect(weekOf("2026-10-14")).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
    ]);
    expect(weekOf("2026-10-18")[0]).toBe("2026-10-12");
    expect(weekOf("2026-10-19")[0]).toBe("2026-10-19");
  });

  it("月またぎ・曜日・表示", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekdayLabel("2026-10-14")).toBe("水");
    expect(formatShort("2026-10-14T11:00:00Z")).toBe("10/14 20:00");
  });

  describe("月の表示のマス", () => {
    it("月曜はじまりの 6 週（42 日）。前後の月の日も入る", () => {
      const g = monthGrid("2026-10");
      expect(g).toHaveLength(42);
      expect(g[0]).toBe("2026-09-28");
      expect(g[3]).toBe("2026-10-01");
      expect(g[41]).toBe("2026-11-08");
      expect(new Set(g.map((d) => weekdayLabel(d)))).toEqual(new Set(["月", "火", "水", "木", "金", "土", "日"]));
      expect(g.filter((_, i) => i % 7 === 0).every((d) => weekdayLabel(d) === "月")).toBe(true);
    });

    it("1 日が月曜の月は、前の月の日を入れずに始まる", () => {
      // 2026-06-01 は月曜
      expect(monthGrid("2026-06")[0]).toBe("2026-06-01");
    });

    it("31 日あって 1 日が日曜の月も、6 週に収まる", () => {
      // 2026-03-01 は日曜。3/31 は 6 週目
      const g = monthGrid("2026-03");
      expect(g[0]).toBe("2026-02-23");
      expect(g).toContain("2026-03-31");
      expect(g[41]).toBe("2026-04-05");
    });

    it("年またぎとうるう年", () => {
      expect(addMonths("2026-12", 1)).toBe("2027-01");
      expect(addMonths("2026-01", -1)).toBe("2025-12");
      expect(addMonths("2026-10", -22)).toBe("2024-12");
      expect(monthGrid("2028-02")).toContain("2028-02-29");
      expect(monthGrid("2027-01")[0]).toBe("2026-12-28");
    });

    it("年月の形を確かめる", () => {
      expect(isYm("2026-10")).toBe(true);
      expect(isYm("2026-13")).toBe(false);
      expect(isYm("2026-1")).toBe(false);
      expect(isYm(["2026-10"])).toBe(false);
      expect(ymOf("2026-10-31")).toBe("2026-10");
    });

    it("月の境目も日本時間で判定する（UTC では 9/30 でも日本では 10/1）", () => {
      expect(ymOf(toYmd(new Date("2026-09-30T15:00:00Z")))).toBe("2026-10");
      expect(ymOf(toYmd(new Date("2026-09-30T14:59:59Z")))).toBe("2026-09");
    });
  });
});
