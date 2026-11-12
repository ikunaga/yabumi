// 概要の数字のカードの選び方と、30 日の比べ（src/lib/overview/numbers.ts。DB は触らない）
import { describe, expect, it } from "vitest";
import { arrivedUntil, chartTicks, compareDays, dailySeries, latestAside, pctChange, peakIndex, pickOverviewCards, slotLabel, type Daily, type OverviewInput } from "@/lib/overview/numbers";
import { addDays, toYmd } from "@/lib/time";

const today = "2026-10-30";
// 今日から n 日前に value
const at = (n: number, value: number): Daily => ({ day: addDays(today, -n), value });

const empty: OverviewInput = { today, downloads: null, clicks: null, published: [], scheduledCount: 0, draftCount: 0, kpis: [], kpiValues: {} };

describe("概要: 30 日の比べ", () => {
  it("直近 30 日（今日を含む）と、その前の 30 日を分けて足す", () => {
    const rows = [at(0, 1), at(29, 2), at(30, 4), at(59, 8), at(60, 16)];
    expect(compareDays(rows, today)).toEqual({ now: 3, before: 12 });
    expect(compareDays(rows, today, 7)).toEqual({ now: 1, before: 0 });
  });

  it("増減は % で小数 1 桁。前が 0 なら比べない", () => {
    expect(pctChange(112, 100)).toBe(12);
    expect(pctChange(2, 3)).toBe(-33.3);
    expect(pctChange(5, 0)).toBeNull();
  });

  it("日ごとの並びは、ない日を 0 で埋め、最後が今日", () => {
    const s = dailySeries([at(0, 3), at(2, 5), at(2, 1)], today, 4);
    expect(s).toEqual([
      { day: "2026-10-27", value: 0 },
      { day: "2026-10-28", value: 6 },
      { day: "2026-10-29", value: 0 },
      { day: "2026-10-30", value: 3 },
    ]);
  });
});

describe("概要: 数字のカード 4 枚（出せるものから。準備中で埋めない）", () => {
  it("何もつないでいない人は、SNS への投稿・予約中・下書きの本当の数だけ（ダウンロードやクリックは出さない）", () => {
    const cards = pickOverviewCards({ ...empty, scheduledCount: 2, draftCount: 5 });
    expect(cards.map((c) => [c.key, c.value])).toEqual([
      ["posts", 0],
      ["scheduled", 2],
      ["drafts", 5],
    ]);
    // 予約中・下書きは比べない
    expect(cards.slice(1).every((c) => c.deltaPct === null && c.unit === "件")).toBe(true);
    expect(cards.some((c) => /SNS 経由|DL 率/.test(c.label))).toBe(false);
  });

  it("ストアと短縮リンクがあれば a ダウンロード・b クリック・c SNS への投稿（予約中の投稿）・d 追いかける数字", () => {
    const cards = pickOverviewCards({
      ...empty,
      downloads: { thisWeek: 112, lastWeek: 100 },
      clicks: [at(3, 30)],
      published: [at(2, 4), at(35, 2)],
      scheduledCount: 3,
      kpis: ["posts", "followers", "views"],
      kpiValues: { followers: { thisWeek: 120, lastWeek: 100 }, views: { thisWeek: 900, lastWeek: 0 } },
    });
    expect(cards.map((c) => c.label)).toEqual(["ダウンロード", "ストアへのクリック", "SNS への投稿", "フォロワーの増え方"]);
    expect(cards[0]).toMatchObject({ value: 112, deltaPct: 12, note: "前の 30 日比" });
    expect(cards[1]).toMatchObject({ value: 30, deltaPct: null, note: "前の 30 日は 0" });
    expect(cards[2]).toMatchObject({ value: 4, deltaPct: 100, note: "予約中の投稿 3 件", unit: "本" });
    expect(cards[3]).toMatchObject({ kpi: "followers", value: 120, deltaPct: 20, note: "直近 7 日・先週比" });
  });

  it("追いかける数字に値がなければ飛ばし、予約中・下書きで埋める", () => {
    const cards = pickOverviewCards({ ...empty, clicks: [], kpis: ["views", "revenue"], kpiValues: {}, scheduledCount: 1, draftCount: 0 });
    expect(cards.map((c) => c.key)).toEqual(["link_clicks", "posts", "scheduled", "drafts"]);
    // 予約中のカードがあるので、SNS への投稿には予約中の投稿の数を添えない
    expect(cards[1].note).toBeUndefined();
  });

  it("売上は通貨と 28 日の添え書きで出す", () => {
    const cards = pickOverviewCards({ ...empty, downloads: { thisWeek: 0, lastWeek: 0 }, clicks: [], kpis: ["revenue"], kpiValues: { revenue: { thisWeek: 12000, lastWeek: 10000, unit: "JPY" } } });
    expect(cards[3]).toMatchObject({ kpi: "revenue", currency: "JPY", deltaPct: 20, note: "直近 28 日・1 週間前比" });
  });
});

describe("概要: Google Play が数えた SNS からの DL", () => {
  it("Google Play をつないでいれば、追いかける数字のあとに出す。名前に Google Play が数えたと書き、前と比べない", () => {
    const cards = pickOverviewCards({ ...empty, playSnsDl: { value: 12 } });
    expect(cards.map((c) => c.key)).toEqual(["posts", "play_dl", "scheduled", "drafts"]);
    expect(cards[1]).toMatchObject({ label: "Google Play が数えた SNS からの DL", value: 12, deltaPct: null, note: "直近 30 日・App Store は入りません" });
    expect(pickOverviewCards({ ...empty, playSnsDl: null }).some((c) => c.key === "play_dl")).toBe(false);
  });
});

describe("概要: 前の期間が数え始める前なら比べない", () => {
  it("短縮リンクを作った日・ストアを取り込み始めた日・プロジェクトを作った日が前の 30 日の始まりより後なら「前の記録はまだありません」", () => {
    const cards = pickOverviewCards({
      ...empty,
      downloads: { thisWeek: 10, lastWeek: 10, noPrev: true },
      clicks: [at(2, 14)],
      published: [at(3, 2)],
      since: { clicks: addDays(today, -5), posts: addDays(today, -5) },
    });
    for (const c of cards.slice(0, 3)) expect(c).toMatchObject({ deltaPct: null, note: "前の記録はまだありません" });
    expect(cards.map((c) => c.value).slice(0, 3)).toEqual([10, 14, 2]);
  });

  it("前の 30 日の始まり（59 日前）かそれより前から数えていれば、いつもどおり比べる。数え始めた日がわからない（null）なら比べない", () => {
    const rows = [at(1, 12), at(40, 10)];
    expect(pickOverviewCards({ ...empty, clicks: rows, since: { clicks: addDays(today, -59) } })[0]).toMatchObject({ deltaPct: 20, note: "前の 30 日比" });
    expect(pickOverviewCards({ ...empty, clicks: rows, since: { clicks: null } })[0]).toMatchObject({ deltaPct: null, note: "前の記録はまだありません" });
  });

  it("ストアのページの閲覧（追いかける数字）は、前の記録がなければ比べない（決めるのは読み込み。storeWeekValue）", () => {
    const base = { ...empty, kpis: ["store_page_views" as const] };
    expect(pickOverviewCards({ ...base, kpiValues: { store_page_views: { thisWeek: 30, lastWeek: 30, noPrev: true } } })[1]).toMatchObject({ kpi: "store_page_views", deltaPct: null, note: "直近 7 日・前の記録はまだありません" });
    expect(pickOverviewCards({ ...base, kpiValues: { store_page_views: { thisWeek: 30, lastWeek: 20 } } })[1]).toMatchObject({ kpi: "store_page_views", deltaPct: 50, note: "直近 7 日・先週比" });
  });
});

describe("概要: 宣伝するものの種類（決定 D34）", () => {
  it("クリックのカードは、アプリなら「ストアへのクリック」、ほかは「行き先へのクリック」", () => {
    expect(pickOverviewCards({ ...empty, clicks: [at(1, 3)] })[0].label).toBe("ストアへのクリック");
    expect(pickOverviewCards({ ...empty, clicks: [at(1, 3)], productType: "service" })[0].label).toBe("行き先へのクリック");
  });
  it("手で記録した成果は、追いかける数字のカードとして出す（前の期間に記録がなければ比べない）", () => {
    const cards = pickOverviewCards({ ...empty, productType: "shop", kpis: ["outcomes"], kpiValues: { outcomes: { thisWeek: 5, lastWeek: 5, noPrev: true } } });
    expect(cards[1]).toMatchObject({ kpi: "outcomes", label: "成果（手で記録）", value: 5, deltaPct: null });
  });
});

describe("概要: 次の予約の時刻", () => {
  const now = new Date("2026-10-30T10:00:00+09:00");
  it("今日は時刻だけ、明日は「明日」、それより先は月/日", () => {
    expect(slotLabel("2026-10-30T18:00:00+09:00", now)).toBe("18:00");
    expect(slotLabel("2026-10-31T12:00:00+09:00", now)).toBe("明日 12:00");
    expect(slotLabel("2026-11-01T09:00:00+09:00", now)).toBe("11/1 09:00");
  });
});

describe("日ごとの棒グラフの目盛りと強調", () => {
  const vals = (...v: number[]): Daily[] => v.map((value, i) => ({ day: addDays(today, i - v.length + 1), value }));

  it("縦の目盛りはいちばん大きい日・その半分・0 で、小さい値でも整数", () => {
    expect(chartTicks(vals(0, 0, 0))).toEqual({ top: 1, ticks: [1, 0] });
    expect(chartTicks(vals(1, 0))).toEqual({ top: 1, ticks: [1, 0] });
    expect(chartTicks(vals(2, 0))).toEqual({ top: 2, ticks: [2, 1, 0] });
    expect(chartTicks(vals(3, 1, 0))).toEqual({ top: 3, ticks: [3, 1, 0] });
    expect(chartTicks(vals(5, 120, 7))).toEqual({ top: 120, ticks: [120, 60, 0] });
    for (const t of chartTicks(vals(7, 3)).ticks) expect(Number.isInteger(t)).toBe(true);
  });

  it("強調はいちばん大きい日（同じなら後の日）。すべて 0 なら強調しない", () => {
    expect(peakIndex(vals(0, 0))).toBeNull();
    expect(peakIndex(vals(5, 2, 5, 0))).toBe(2);
    expect(peakIndex(vals(1, 9, 0))).toBe(1);
  });
});

describe("日ごとの棒グラフの日付と、遅れて届く数字", () => {
  it("日付は日本時間で区切る（日本時間の 11/3 0:30 は 11/3。グラフの最後の日）", () => {
    const today = toYmd(new Date("2026-11-02T15:30:00Z"));
    expect(today).toBe("2026-11-03");
    const rows = dailySeries([{ day: "2026-10-30", value: 3 }, { day: "2026-11-01", value: 4 }], today, 14);
    expect(rows.at(-1)).toEqual({ day: "2026-11-03", value: 0 });
    // 4 日前・2 日前は、最後から 5 本目・3 本目
    expect(rows.at(-5)).toEqual({ day: "2026-10-30", value: 3 });
    expect(rows.at(-3)).toEqual({ day: "2026-11-01", value: 4 });
    // 日本時間の 11/2 23:59 はまだ 11/2
    expect(toYmd(new Date("2026-11-02T14:59:00Z"))).toBe("2026-11-02");
  });

  it("届いている日は、ストアごとのいちばん新しい日のうち早いほう", () => {
    const rows = [
      { day: "2026-10-31", source: "app_store" },
      { day: "2026-11-01", source: "app_store" },
      { day: "2026-10-30", source: "google_play" },
      { day: "2026-11-02", source: "app_store_views" },
    ];
    expect(arrivedUntil(rows, ["app_store", "google_play"])).toBe("2026-10-30");
    expect(arrivedUntil(rows, ["app_store"])).toBe("2026-11-01");
    expect(arrivedUntil(rows, ["app_store_views", "google_play"])).toBe("2026-10-30");
    expect(arrivedUntil([], ["app_store"])).toBeNull();
  });

  it("見出しの右: いつも届く数字は「今日」、遅れて届く数字は届いている日まで「最新」", () => {
    const rows = [
      { day: "2026-10-31", value: 5 },
      { day: "2026-11-01", value: 23 },
      { day: "2026-11-02", value: 0 },
      { day: "2026-11-03", value: 0 },
    ];
    expect(latestAside(rows)).toBe("今日 0");
    expect(latestAside(rows, "2026-11-01")).toBe("最新 11/1: 23");
    expect(latestAside(rows, "2026-11-03")).toBe("最新 11/3: 0");
    expect(latestAside(rows, "2026-10-20")).toBe("最新 10/20");
    expect(latestAside(rows, null)).toBe("まだ届いていません");
  });
});
