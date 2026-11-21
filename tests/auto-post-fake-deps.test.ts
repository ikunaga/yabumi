// 自動投稿の偽の AI（AUTO_POST_FAKE_AI）では、本物の AI（Anthropic・Google）を呼ぶものを残さない（2026-11-21 PM の指摘。
// 画面の確かめで、ダミーの鍵で Anthropic に呼び出しが出たため）
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { engineDeps } = await import("@/lib/auto-post/engine");
const anthropic = await import("@/lib/ai/anthropic");

afterEach(() => vi.unstubAllEnvs());

describe("engineDeps", () => {
  it("偽の AI のときは、縮める AI を使わず、シリーズの空欄も偽の言葉、チェックと画像も偽物", () => {
    vi.stubEnv("AUTO_POST_FAKE_AI", "ok");
    vi.stubEnv("VERCEL_ENV", "");
    const d = engineDeps({} as never)!;
    expect(d).not.toBeNull();
    expect(d.callShorten).toBeUndefined();
    expect(d.fakeSeries).toBe(true);
    expect(d.callFormatRound).toBeUndefined();
    expect(d.callCheck).not.toBe(anthropic.callAiCheck);
    expect(d.image?.callScene).not.toBe(anthropic.callPhotoIdeas);
  });
});
