import { afterEach, describe, expect, it, vi } from "vitest";
import { envReady } from "@/lib/env-check";

afterEach(() => vi.restoreAllMocks());

describe("環境変数の確認", () => {
  it("足りない変数の名前だけをログに出す（値は出さない）。同じ機能は 1 回だけ", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { A: "secret-value", B: "" };
    expect(envReady("テスト機能", ["A", "B", "C"], env)).toBe(false);
    expect(envReady("テスト機能", ["A", "B", "C"], env)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("B, C");
    expect(msg).not.toContain("secret-value");
  });

  it("そろっていれば true で、何も出さない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(envReady("そろった機能", ["A"], { A: "x" })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
