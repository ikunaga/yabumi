import { describe, expect, it } from "vitest";
import { calendarViewCookie, resolveCalendarView } from "@/lib/calendar-view";

describe("カレンダーの表示（週・月）", () => {
  it("URL の指定がなければ、覚えた表示を最初から出す。覚えていなければ週", () => {
    expect(resolveCalendarView({}, "month")).toBe("month");
    expect(resolveCalendarView({}, "week")).toBe("week");
    expect(resolveCalendarView({}, undefined)).toBe("week");
    expect(resolveCalendarView({}, "<script>")).toBe("week");
  });

  it("「予約しました」などの知らせだけなら、覚えた表示のまま", () => {
    expect(resolveCalendarView({ done: "deleted" }, "month")).toBe("month");
  });

  it("URL で指定したら、覚えた表示より URL を優先する（戻る・共有で同じ表示）", () => {
    expect(resolveCalendarView({ view: "month", month: "2026-10" }, "week")).toBe("month");
    expect(resolveCalendarView({ view: "week" }, "month")).toBe("week");
    // 予約したあとの戻り（?week=）は週
    expect(resolveCalendarView({ week: "2026-10-12", done: "scheduled" }, "month")).toBe("week");
    expect(resolveCalendarView({ month: "2026-10" }, "month")).toBe("week");
  });

  it("cookie は表示の種類だけ。1 年、SameSite=Lax、https では Secure", () => {
    expect(calendarViewCookie("month", true)).toBe("yabumi_calendar_view=month; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(calendarViewCookie("week", false)).toBe("yabumi_calendar_view=week; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});
