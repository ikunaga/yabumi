import { describe, expect, it } from "vitest";
import { isAuthorizedJob } from "@/lib/jobs/auth";
import { MAX_ATTEMPTS, retryDelayMs } from "@/lib/sns/publisher";

const secret = "a".repeat(64);

describe("ジョブ API の合言葉", () => {
  it("合言葉が一致すれば通す", () => {
    expect(isAuthorizedJob(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("違う・ない・短すぎる合言葉は通さない", () => {
    expect(isAuthorizedJob(`Bearer ${"b".repeat(64)}`, secret)).toBe(false);
    expect(isAuthorizedJob(null, secret)).toBe(false);
    expect(isAuthorizedJob(secret, secret)).toBe(false);
    expect(isAuthorizedJob(`Bearer ${secret}`, undefined)).toBe(false);
    expect(isAuthorizedJob("Bearer short", "short")).toBe(false);
  });
});

describe("やり直しの間隔", () => {
  it("1 回目の失敗は 1 分後、2 回目は 5 分後、3 回目であきらめる", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(300_000);
    expect(retryDelayMs(MAX_ATTEMPTS)).toBeNull();
  });
});
