// 遅れて届く数字（ストアのダウンロード・ストアのページの閲覧・Google Play と Apple が数えた SNS ごとの DL）を、
// 届いている日で終わる期間で数えて比べ、終わりの日を書く（src/lib/metrics/store-period.ts。DB は触らない）
import { describe, expect, it } from "vitest";
import { kpiLine } from "@/lib/ai/consult-prompt";
import { utmEnd } from "@/lib/metrics/play-utm";
import { compareLabel, periodLabel, storeEnd, storePrevKnown, storeWeekValue } from "@/lib/metrics/store-period";
import { arrivedUntil, chartWindow, pickOverviewCards, type OverviewInput } from "@/lib/overview/numbers";

const today = "2026-11-03";
const empty: OverviewInput = { today, downloads: null, clicks: null, published: [], scheduledCount: 0, draftCount: 0, kpis: [], kpiValues: {} };

describe("期間の終わりと書き方", () => {
  it("届いている日が今日より前ならその日で終わり、今日かそれより後なら今日", () => {
    expect(storeEnd(today, "2026-10-30")).toBe("2026-10-30");
    expect(storeEnd(today, today)).toBe(today);
    expect(storeEnd(today, "2026-11-04")).toBe(today);
    expect(storeEnd(today, null)).toBe(today);
  });

  it("前の期間の始まり（終わりから 2 × 日数 − 1 日前）より前から数えていれば比べる", () => {
    expect(storePrevKnown("2026-10-17", "2026-10-30", 7)).toBe(true);
    expect(storePrevKnown("2026-10-18", "2026-10-30", 7)).toBe(false);
    expect(storePrevKnown(null, "2026-10-30", 7)).toBe(false);
  });

  it("終わりの日があれば「10/30 までの 7 日」「その前の 7 日比」", () => {
    expect(periodLabel(7)).toBe("直近 7 日");
    expect(periodLabel(30, "2026-10-30")).toBe("10/30 までの 30 日");
    expect(compareLabel(7)).toBe("先週比");
    expect(compareLabel(30)).toBe("前の 30 日比");
    expect(compareLabel(7, "2026-10-30")).toBe("その前の 7 日比");
  });
});

describe("届いている日で終わる期間の値（storeWeekValue）", () => {
  const sum = (end: string) => (end === "2026-10-30" ? { now: 536, prev: 1100 } : { now: 999, prev: 999 });

  it("取り込んだことがなければ出さない。どこからも届いていなければ数を出さない（notArrived）", () => {
    expect(storeWeekValue({ since: null, until: null }, today, 7, sum)).toBeUndefined();
    expect(storeWeekValue({ since: "2026-08-01", until: null }, today, 7, sum)).toEqual({ thisWeek: 0, lastWeek: 0, notArrived: true });
  });

  it("届いている日で終わる期間で数え、終わりの日を持つ（今日で終わる期間では数えない）", () => {
    expect(storeWeekValue({ since: "2026-08-01", until: "2026-10-30" }, today, 7, sum)).toEqual({ thisWeek: 536, lastWeek: 1100, until: "2026-10-30" });
    // 今日まで届いていれば終わりの日は書かない
    expect(storeWeekValue({ since: "2026-08-01", until: today }, today, 7, sum)).toEqual({ thisWeek: 999, lastWeek: 999 });
  });

  it("前の期間が数え始める前にかかれば比べない（終わりの日から数える）", () => {
    expect(storeWeekValue({ since: "2026-10-20", until: "2026-10-30" }, today, 7, sum)).toEqual({ thisWeek: 536, lastWeek: 536, noPrev: true, until: "2026-10-30" });
  });
});

describe("概要のカード", () => {
  it("ダウンロードは「10/30 までの 30 日・その前の 30 日比」、今日まで届いていれば「前の 30 日比」", () => {
    expect(pickOverviewCards({ ...empty, downloads: { thisWeek: 90, lastWeek: 100, until: "2026-10-30" } })[0]).toMatchObject({ key: "downloads", value: 90, deltaPct: -10, note: "10/30 までの 30 日・その前の 30 日比" });
    expect(pickOverviewCards({ ...empty, downloads: { thisWeek: 90, lastWeek: 100 } })[0]).toMatchObject({ deltaPct: -10, note: "前の 30 日比" });
    expect(pickOverviewCards({ ...empty, downloads: { thisWeek: 5, lastWeek: 0, until: "2026-10-30" } })[0]).toMatchObject({ deltaPct: null, note: "10/30 までの 30 日・その前の 30 日は 0" });
    expect(pickOverviewCards({ ...empty, downloads: { thisWeek: 5, lastWeek: 5, noPrev: true, until: "2026-10-30" } })[0]).toMatchObject({ deltaPct: null, note: "10/30 までの 30 日・前の記録はまだありません" });
  });

  it("どこからも届いていなければ数を出さず「まだ届いていません」", () => {
    expect(pickOverviewCards({ ...empty, downloads: { thisWeek: 0, lastWeek: 0, notArrived: true } })[0]).toMatchObject({ key: "downloads", notArrived: true, deltaPct: null, note: "まだ届いていません" });
  });

  it("ストアのページの閲覧（7 日）にも終わりの日を書く", () => {
    const cards = pickOverviewCards({ ...empty, kpis: ["store_page_views"], kpiValues: { store_page_views: { thisWeek: 120, lastWeek: 100, until: "2026-10-30" } } });
    expect(cards[1]).toMatchObject({ kpi: "store_page_views", deltaPct: 20, note: "10/30 までの 7 日・その前の 7 日比" });
  });

  it("Google Play が数えた SNS からの DL も、届いている日で終わる 30 日", () => {
    expect(pickOverviewCards({ ...empty, playSnsDl: { value: 12, until: "2026-10-28" } })[1]).toMatchObject({ key: "play_dl", value: 12, note: "10/28 までの 30 日・App Store は入りません" });
    expect(pickOverviewCards({ ...empty, playSnsDl: { value: 0, notArrived: true } })[1]).toMatchObject({ key: "play_dl", notArrived: true, note: "まだ届いていません" });
  });
});

describe("Google Play・Apple の SNS ごとの DL の終わりの日（utmEnd）", () => {
  it("届いているいちばん新しい日。今日より後にはしない。なければ null", () => {
    const row = (day: string) => ({ day, by_source: {}, by_campaign: {}, other: 0 });
    expect(utmEnd([row("2026-10-27"), row("2026-10-29"), row("2026-10-28")], today)).toBe("2026-10-29");
    expect(utmEnd([row("2026-11-05")], today)).toBe(today);
    expect(utmEnd([], today)).toBeNull();
  });
});

describe("AI に渡す数字", () => {
  it("届いている日で終わる 7 日なら、終わりの日と、それより後は数えていないことを添える", () => {
    const line = kpiLine({ kpi: "downloads", thisWeek: 536, lastWeek: 1100, until: "2026-10-30" });
    expect(line).toContain("2026-10-30 までの 7 日");
    expect(line).toContain("数日遅れて届く");
    expect(line).toContain("536、その前の 7 日 1100");
    expect(kpiLine({ kpi: "downloads", thisWeek: 536, lastWeek: 1100 })).toBe("ダウンロード（downloads）: 直近 7 日 536、その前の 7 日 1100");
  });

  it("まだ届いていなければ数を渡さず、0 ではないと書く。前の記録がなければ比べないと書く", () => {
    expect(kpiLine({ kpi: "store_page_views", thisWeek: 0, lastWeek: 0, notArrived: true })).toMatch(/まだ届いていない.*0 ではない/);
    const noPrev = kpiLine({ kpi: "downloads", thisWeek: 40, lastWeek: 40, noPrev: true, until: "2026-10-30" });
    expect(noPrev).toContain("比べない");
    expect(noPrev).not.toContain("その前の 7 日 40");
  });
});

describe("日ごとの棒の期間（chartWindow）", () => {
  const series = [
    { day: "2026-10-24", value: 1 },
    { day: "2026-10-30", value: 221 },
  ];

  it("届いていない日があれば、届いている日で終わる期間の棒にし、まだ届いていない日数を書く", () => {
    const w = chartWindow(series, today, 7, "2026-10-30")!;
    expect(w.rows.map((r) => r.day)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(w.rows.reduce((n, r) => n + r.value, 0)).toBe(222);
    expect(w).toMatchObject({ until: "2026-10-30", note: "11/3 までの 4 日はまだ届いていません" });
  });

  it("いつも届く数字と、今日まで届いているときは今日で終わる。どこからも届いていなければ null", () => {
    expect(chartWindow(series, today, 7)).toEqual({ rows: expect.any(Array) });
    expect(chartWindow(series, today, 7)!.rows.at(-1)!.day).toBe(today);
    expect(chartWindow(series, today, 7, today)).not.toHaveProperty("note");
    expect(chartWindow(series, today, 7, null)).toBeNull();
  });
});

describe("届いた日は、いまつないでいるストアの中だけで決める（arrivedUntil）", () => {
  const rows = [
    { day: "2026-11-02", source: "app_store" },
    { day: "2026-10-31", source: "google_play" },
  ];
  it("外したストアの最後の日に引っ張られない。どれもつないでいなければ、残っている数字で決める", () => {
    expect(arrivedUntil(rows, ["app_store", "google_play"])).toBe("2026-10-31");
    expect(arrivedUntil(rows, ["app_store", "google_play"], ["app_store"])).toBe("2026-11-02");
    expect(arrivedUntil(rows, ["app_store", "google_play"], ["app_store", "google_play"])).toBe("2026-10-31");
    expect(arrivedUntil(rows, ["app_store", "google_play"], [])).toBe("2026-10-31");
    expect(arrivedUntil(rows, ["app_store_views", "google_play"], ["app_store"])).toBe("2026-10-31");
  });
});
