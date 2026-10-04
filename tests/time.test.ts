import { describe, expect, it } from "vitest";
import { addDays, formatShort, fromInputValue, toInputValue, toYmd, weekOf, weekdayLabel } from "@/lib/time";

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
});
