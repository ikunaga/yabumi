// 「確認して送る」SNS の押し忘れを防ぐ知らせの時刻（remind.ts。2026-11-28）。時刻はすべて日本時間で見る
import { describe, expect, it } from "vitest";
import { isQuietHour, remindAt, remindDecision } from "@/lib/auto-post/remind";

const jst = (s: string) => new Date(`${s}+09:00`);

describe("リマインドの時刻", () => {
  it("送る 3 時間前。夜中（22:00〜翌 8:00）にかかるときは、その前の 21:00 に早める", () => {
    expect(remindAt(jst("2026-11-29T21:00:00"))).toEqual(jst("2026-11-29T18:00:00"));
    expect(remindAt(jst("2026-11-29T11:00:00"))).toEqual(jst("2026-11-29T08:00:00"));
    expect(remindAt(jst("2026-11-30T00:30:00"))).toEqual(jst("2026-11-29T21:30:00"));
    expect(remindAt(jst("2026-11-30T01:00:00"))).toEqual(jst("2026-11-29T21:00:00"));
    expect(remindAt(jst("2026-11-30T09:00:00"))).toEqual(jst("2026-11-29T21:00:00"));
    expect(remindAt(jst("2026-11-30T10:59:00"))).toEqual(jst("2026-11-29T21:00:00"));
  });

  it("夜中の判定", () => {
    expect(isQuietHour(jst("2026-11-29T21:59:00"))).toBe(false);
    expect(isQuietHour(jst("2026-11-29T22:00:00"))).toBe(true);
    expect(isQuietHour(jst("2026-11-30T07:59:00"))).toBe(true);
    expect(isQuietHour(jst("2026-11-30T08:00:00"))).toBe(false);
  });

  it("送る・待つ・送らない", () => {
    const due = "2026-11-29T12:00:00.000Z"; // 21:00 JST → 18:00 に知らせる
    expect(remindDecision({ due_at: due }, jst("2026-11-29T17:59:00"))).toBe("wait");
    expect(remindDecision({ due_at: due }, jst("2026-11-29T18:00:00"))).toBe("send");
    expect(remindDecision({ due_at: due, notified_at: jst("2026-11-28T21:00:00").toISOString() }, jst("2026-11-29T18:10:00"))).toBe("send");
    // 作った知らせから 1 時間たたないうちは送らない
    expect(remindDecision({ due_at: due, notified_at: jst("2026-11-29T17:30:00").toISOString() }, jst("2026-11-29T18:10:00"))).toBe("skip");
    // 届かずに試し直すうちに夜中になったら、待つ（送る時刻を過ぎたら送らない）
    const late = "2026-11-29T14:30:00.000Z"; // 23:30 JST → 20:30 に知らせる
    expect(remindDecision({ due_at: late }, jst("2026-11-29T22:05:00"))).toBe("wait");
    expect(remindDecision({ due_at: late }, jst("2026-11-29T23:40:00"))).toBe("skip");
  });
});
