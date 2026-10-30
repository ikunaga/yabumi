// 時間帯ごとの傾向（数字の段 4）: 時間帯の分け方、少ない帯を比べないしきい値、「この時間帯にする」で入る日時
import { describe, expect, it } from "vitest";
import { bandOfHour, plannedAtFor, summarizeTrends } from "@/lib/metrics/time-bands";
import { timeHintOf } from "@/lib/metrics/time-hint";

describe("時間帯の分け方（日本時間）", () => {
  it("朝 5〜10 時台・昼 11〜15 時台・夕 16〜19 時台・夜 20〜4 時台", () => {
    expect([4, 5, 10, 11, 15, 16, 19, 20, 23, 0].map(bandOfHour)).toEqual(["night", "morning", "morning", "noon", "noon", "evening", "evening", "night", "night", "night"]);
  });
});

const row = (band: string, posts: number, avgViews: number | null, clicks: number) => ({ band, posts, avgViews, clicks });

describe("しきい値", () => {
  it("5 本以上の帯が 2 つ以上あるときだけ、よく見られる帯を出す（5 本未満の帯は入れない）", () => {
    const t = summarizeTrends([row("morning", 5, 120, 0), row("night", 8, 300, 0), row("noon", 4, 9999, 0)]);
    expect(t.views).toEqual({
      ready: true,
      best: "night",
      bands: [
        { band: "morning", value: 120, count: 5 },
        { band: "night", value: 300, count: 8 },
      ],
    });
  });

  it("足りない間は比べず、あと何本で出るかを返す（多い 2 つの帯がそれぞれ 5 本に届くまで）", () => {
    expect(summarizeTrends([row("night", 7, 300, 0), row("noon", 3, 50, 0)]).views).toEqual({ ready: false, need: 2 });
    expect(summarizeTrends([]).views).toEqual({ ready: false, need: 10 });
    // 閲覧数が取れていない帯（avgViews が null）は数えない
    expect(summarizeTrends([row("night", 7, 300, 0), row("noon", 9, null, 0)]).views).toEqual({ ready: false, need: 5 });
  });

  it("クリックは 5 回以上の帯が 2 つ以上で比べる", () => {
    expect(summarizeTrends([row("evening", 0, null, 12), row("night", 0, null, 5)]).clicks).toMatchObject({ ready: true, best: "evening" });
    expect(summarizeTrends([row("evening", 0, null, 40), row("night", 0, null, 4)]).clicks).toEqual({ ready: false, need: 1 });
  });

  it("日時の欄の一言は、閲覧が比べられればそれ、なければクリック、どちらもなければ出さない", () => {
    expect(timeHintOf(summarizeTrends([row("morning", 5, 1, 0), row("night", 5, 2, 0), row("noon", 0, null, 50), row("evening", 0, null, 60)]))).toEqual({ band: "night", kind: "views" });
    expect(timeHintOf(summarizeTrends([row("noon", 0, null, 50), row("evening", 0, null, 60)]))).toEqual({ band: "evening", kind: "clicks" });
    expect(timeHintOf(summarizeTrends([row("noon", 2, 10, 3)]))).toBeNull();
  });
});

describe("この時間帯にする", () => {
  it("日付が決まっていれば、その日のその時間帯の時刻にする", () => {
    expect(plannedAtFor("night", "2026-11-03T09:30", "2026-10-30", "10:00")).toBe("2026-11-03T21:00");
  });
  it("日付がなければ今日。時刻を過ぎていれば翌日（月末をまたぐ）", () => {
    expect(plannedAtFor("evening", "", "2026-10-30", "10:00")).toBe("2026-10-30T18:00");
    expect(plannedAtFor("morning", "", "2026-10-31", "09:00")).toBe("2026-11-01T08:00");
  });
});
