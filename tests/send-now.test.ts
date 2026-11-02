// 今すぐ送る（4.36）で、送ってよい投稿か
import { describe, expect, it } from "vitest";
import { isSendNowPost } from "@/lib/posts/send-now";

const now = new Date("2026-11-02T10:00:00Z");

describe("今すぐ送ってよい投稿", () => {
  it("いま送る予約（保存したばかり）の投稿は送ってよい", () => {
    expect(isSendNowPost({ status: "scheduled", planned_at: "2026-11-02T09:59:58Z" }, now)).toBe(true);
    // アプリと DB の時計が少しずれていても送れる
    expect(isSendNowPost({ status: "scheduled", planned_at: "2026-11-02T10:00:30Z" }, now)).toBe(true);
  });

  it("先の日時の予約・下書き・日時のない投稿は、ここから送らない", () => {
    expect(isSendNowPost({ status: "scheduled", planned_at: "2026-11-02T12:00:00Z" }, now)).toBe(false);
    expect(isSendNowPost({ status: "draft", planned_at: "2026-11-02T09:59:58Z" }, now)).toBe(false);
    expect(isSendNowPost({ status: "scheduled", planned_at: null }, now)).toBe(false);
  });
});
