import { describe, expect, it } from "vitest";
import { scheduleText } from "@/components/auto-post/format";
import { projectNavItems, activeNavKey } from "@/components/nav/project-nav-items";

// 自動の投稿の画面（feat/auto-post-ui）の、画面の文とメニューの項目
describe("scheduleText", () => {
  const base = { time: "19:00", every_weeks: 1 as const, start: "2026-11-16" };
  it("曜日を ISO の順（月〜日）に並べる", () => {
    expect(scheduleText({ ...base, weekdays: [5, 2] })).toBe("週 2（火・金） 19:00");
  });
  it("7 日すべてで毎週なら「毎日」", () => {
    expect(scheduleText({ ...base, weekdays: [1, 2, 3, 4, 5, 6, 7], time: "12:00" })).toBe("毎日 12:00");
  });
  it("2 週ごと以上は間隔を書く（7 日でも毎日とは言わない）", () => {
    expect(scheduleText({ ...base, weekdays: [3], every_weeks: 2, time: "09:00" })).toBe("2 週ごと 1（水） 09:00");
    expect(scheduleText({ ...base, weekdays: [1, 2, 3, 4, 5, 6, 7], every_weeks: 2 })).toMatch(/^2 週ごと 7/);
  });
});

describe("メニューの「自動の投稿」", () => {
  it("「…」（その他）に出し、/auto 以下で選んでいる印を付ける", () => {
    const item = projectNavItems("p1").find((i) => i.key === "auto");
    expect(item).toMatchObject({ label: "自動の投稿", barLabel: "Autopilot", href: "/projects/p1/auto", main: false });
    expect(activeNavKey("auto")).toBe("auto");
  });
});
