// 投稿した日と DL（またはクリック）の関係（src/lib/metrics/post-effect.ts。数字の段 1）
import { describe, expect, it } from "vitest";
import { confirmedUntil, MIN_DAYS, postEffect } from "@/lib/metrics/post-effect";
import type { Daily } from "@/lib/overview/numbers";
import { addDays } from "@/lib/time";

const from = "2026-10-01";
const d = (n: number) => addDays(from, n);

describe("投稿した日と DL の関係", () => {
  it("投稿した日とその翌日を「投稿した日」に、ほかを「しなかった日」に分け、1 日あたりを出す", () => {
    // 10/1 と 10/5 に投稿 → 10/1・10/2・10/5・10/6 が「投稿した日と翌日」
    const published: Daily[] = [
      { day: d(0), value: 1 },
      { day: d(4), value: 2 },
      { day: d(3), value: 0 },
    ];
    const values: Daily[] = [d(0), d(1), d(4), d(5)].map((day) => ({ day, value: 10 })).concat([{ day: d(2), value: 4 }, { day: d(2), value: 2 }]);
    const e = postEffect(published, values, d(0), d(6));
    expect(e).toMatchObject({ postedDays: 4, quietDays: 3, postedAvg: 10, quietAvg: 2, ready: false });
  });

  it(`どちらも ${MIN_DAYS} 日そろったら比べる。範囲の外の日は数えない`, () => {
    const published: Daily[] = Array.from({ length: 30 }, (_, i) => ({ day: d(i), value: i % 4 === 0 ? 1 : 0 }));
    const values: Daily[] = [{ day: d(-1), value: 999 }, { day: d(28), value: 999 }];
    const e = postEffect(published, values, d(0), d(27));
    expect(e.postedDays).toBeGreaterThanOrEqual(MIN_DAYS);
    expect(e.quietDays).toBeGreaterThanOrEqual(MIN_DAYS);
    expect(e.ready).toBe(true);
    expect(e.postedAvg + e.quietAvg).toBe(0);
  });

  it("比べる終わりの日: クリックは昨日まで。DL は取り込んだいちばん新しい日まで（Google Play は 7 日前まで）。ストアがなければ比べない", () => {
    const today = "2026-10-30";
    expect(confirmedUntil(today, "link_clicks", {})).toBe("2026-10-29");
    expect(confirmedUntil(today, "downloads", { app_store: "2026-10-28" })).toBe("2026-10-28");
    expect(confirmedUntil(today, "downloads", { app_store: "2026-10-29", google_play: "2026-10-27" })).toBe("2026-10-23");
    expect(confirmedUntil(today, "downloads", {})).toBeNull();
  });
});
