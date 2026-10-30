// Google Play が数えた、矢書の短縮リンクごとの DL（src/lib/metrics/play-utm.ts。数字の段 3）
import { describe, expect, it } from "vitest";
import { campaignTotal, sumPlayUtm, type PlayUtmRow } from "@/lib/metrics/play-utm";

const rows: PlayUtmRow[] = [
  { day: "2026-10-01", by_source: { x: 5 }, by_campaign: { a1: 5 }, other: 1 },
  { day: "2026-10-20", by_source: { x: 2, instagram: 4, link: 1 }, by_campaign: { a1: 2, b2: 4 }, other: 3 },
  { day: "2026-10-25", by_source: { x: 1, unknown: 9 }, by_campaign: { c3: 1 }, other: 0 },
];

describe("Google Play が数えた DL", () => {
  it("期間の中だけを SNS ごとに足し、多い順。SNS を決めていないリンクと SNS でない名前は、まとめて null", () => {
    const t = sumPlayUtm(rows, "2026-10-10", "2026-10-30");
    expect(t.bySns).toEqual([
      { sns: null, value: 10 },
      { sns: "instagram", value: 4 },
      { sns: "x", value: 3 },
    ]);
    expect(t.total).toBe(17);
    expect(t.other).toBe(3);
    expect(t.byCampaign).toEqual({ a1: 2, b2: 4, c3: 1 });
  });

  it("投稿のリンクのコードから、その投稿の DL を足す（ないコードは 0）", () => {
    expect(campaignTotal({ a1: 2, b2: 4 }, ["a1", "zz"])).toBe(2);
    expect(campaignTotal({}, [])).toBe(0);
  });
});
