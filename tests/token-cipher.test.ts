import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, parseKey } from "@/lib/crypto/token-cipher";

const key = randomBytes(32);

describe("トークンの暗号化", () => {
  it("暗号化したものを同じ鍵と行 ID で戻せる", () => {
    const sealed = encryptToken("THAA-secret-token", "row-1", key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("THAA-secret-token");
    expect(decryptToken(sealed, "row-1", key)).toBe("THAA-secret-token");
  });

  it("同じ値でも毎回違う暗号文になる", () => {
    expect(encryptToken("t", "row-1", key)).not.toBe(encryptToken("t", "row-1", key));
  });

  it("別の行の暗号文は戻せない（差し替え対策）", () => {
    const sealed = encryptToken("t", "row-1", key);
    expect(() => decryptToken(sealed, "row-2", key)).toThrow();
  });

  it("別の鍵や書き換えられた暗号文は戻せない", () => {
    const sealed = encryptToken("token", "row-1", key);
    expect(() => decryptToken(sealed, "row-1", randomBytes(32))).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."), "row-1", key)).toThrow();
  });

  it("鍵は 32 バイトでなければ使わない", () => {
    expect(() => parseKey(undefined)).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 バイト/);
    expect(parseKey(key.toString("base64")).equals(key)).toBe(true);
  });
});
