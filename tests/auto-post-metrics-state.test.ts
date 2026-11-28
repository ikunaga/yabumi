// 回し方の画面の、配信先ごとの数字の状態（2026-11-28: 前は「—」で、送っていないように読めた）
import { describe, expect, it } from "vitest";
import { firstMetricsRead, metricsState } from "@/lib/auto-post/metrics-state";

describe("数字の状態", () => {
  it("最初に読む朝は、送ってから 24 時間たったあとの日本時間 5 時", () => {
    // 11/26 21:00 JST に送った → 11/27 21:00 に 24 時間 → 11/28 5:00 JST
    expect(firstMetricsRead(new Date("2026-11-26T12:00:00Z")).toISOString()).toBe("2026-11-27T20:00:00.000Z");
    // 11/26 3:00 JST に送った → 11/27 3:00 → 11/27 5:00 JST
    expect(firstMetricsRead(new Date("2026-11-25T18:00:00Z")).toISOString()).toBe("2026-11-26T20:00:00.000Z");
  });

  it("値があれば has（0 も値）。読まない SNS は off。最初の朝より前は waiting、過ぎても入っていなければ missing", () => {
    const sent = "2026-11-26T12:00:00Z";
    const env = "threads,instagram";
    expect(metricsState("threads", sent, 0, new Date("2026-11-28T00:00:00Z"), env)).toEqual({ state: "has" });
    expect(metricsState("x", sent, null, new Date("2026-11-27T00:00:00Z"), env)).toEqual({ state: "off" });
    expect(metricsState("instagram", sent, null, new Date("2026-11-27T00:00:00Z"), env)).toEqual({ state: "waiting", firstRead: "2026-11-27T20:00:00.000Z" });
    // 朝のジョブ（5:00〜5:50）の間は、まだ waiting
    expect(metricsState("instagram", sent, null, new Date("2026-11-27T20:30:00Z"), env).state).toBe("waiting");
    expect(metricsState("instagram", sent, null, new Date("2026-11-28T03:00:00Z"), env)).toEqual({ state: "missing" });
  });
});
