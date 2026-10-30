// 概要の数字のカードの選び方と、30 日の比べ（src/lib/overview/numbers.ts。DB は触らない）
import { describe, expect, it } from "vitest";
import { compareDays, dailySeries, pctChange, pickOverviewCards, slotLabel, type Daily, type OverviewInput } from "@/lib/overview/numbers";
import { addDays } from "@/lib/time";

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
  it("何もつないでいない人は、投稿数・予約中・下書きの本当の数だけ（ダウンロードやクリックは出さない）", () => {
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

  it("ストアと短縮リンクがあれば a ダウンロード・b クリック・c 投稿数（うち予約）・d 追いかける数字", () => {
    const cards = pickOverviewCards({
      ...empty,
      downloads: [at(1, 112), at(40, 100)],
      clicks: [at(3, 30)],
      published: [at(2, 4), at(35, 2)],
      scheduledCount: 3,
      kpis: ["posts", "followers", "views"],
      kpiValues: { followers: { thisWeek: 120, lastWeek: 100 }, views: { thisWeek: 900, lastWeek: 0 } },
    });
    expect(cards.map((c) => c.label)).toEqual(["ダウンロード", "ストアへのクリック", "投稿数", "フォロワーの増え方"]);
    expect(cards[0]).toMatchObject({ value: 112, deltaPct: 12, note: "前の 30 日比" });
    expect(cards[1]).toMatchObject({ value: 30, deltaPct: null, note: "前の 30 日は 0" });
    expect(cards[2]).toMatchObject({ value: 4, deltaPct: 100, note: "うち予約 3 件" });
    expect(cards[3]).toMatchObject({ kpi: "followers", value: 120, deltaPct: 20, note: "直近 7 日・先週比" });
  });

  it("追いかける数字に値がなければ飛ばし、予約中・下書きで埋める", () => {
    const cards = pickOverviewCards({ ...empty, clicks: [], kpis: ["views", "revenue"], kpiValues: {}, scheduledCount: 1, draftCount: 0 });
    expect(cards.map((c) => c.key)).toEqual(["link_clicks", "posts", "scheduled", "drafts"]);
    // 予約中のカードがあるので、投稿数には「うち予約」を添えない
    expect(cards[1].note).toBeUndefined();
  });

  it("売上は通貨と 28 日の添え書きで出す", () => {
    const cards = pickOverviewCards({ ...empty, downloads: [], clicks: [], kpis: ["revenue"], kpiValues: { revenue: { thisWeek: 12000, lastWeek: 10000, unit: "JPY" } } });
    expect(cards[3]).toMatchObject({ kpi: "revenue", currency: "JPY", deltaPct: 20, note: "直近 28 日・1 週間前比" });
  });
});

describe("概要: Google Play が数えた SNS からの DL", () => {
  it("Google Play をつないでいれば、追いかける数字のあとに出す。名前に Google Play が数えたと書き、前と比べない", () => {
    const cards = pickOverviewCards({ ...empty, playSnsDl: 12 });
    expect(cards.map((c) => c.key)).toEqual(["posts", "play_dl", "scheduled", "drafts"]);
    expect(cards[1]).toMatchObject({ label: "Google Play が数えた SNS からの DL", value: 12, deltaPct: null, note: "直近 30 日・App Store は入りません" });
    expect(pickOverviewCards({ ...empty, playSnsDl: null }).some((c) => c.key === "play_dl")).toBe(false);
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
