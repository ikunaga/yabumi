import { describe, expect, it } from "vitest";
import { isSignupAllowed } from "@/lib/auth/signup-policy";

describe("新規登録を許すメールアドレス", () => {
  it("設定がなければ（ローカルの開発）誰でも登録できる", () => {
    expect(isSignupAllowed("a@example.com", undefined)).toBe(true);
  });

  it("設定があれば、そのアドレスだけ（大文字小文字と空白は無視）", () => {
    const list = " Owner@Example.com, second@example.com ";
    expect(isSignupAllowed("owner@example.com", list)).toBe(true);
    expect(isSignupAllowed(" SECOND@example.com", list)).toBe(true);
    expect(isSignupAllowed("stranger@example.com", list)).toBe(false);
  });

  it("空の設定なら誰も登録できない（登録を閉じる）", () => {
    expect(isSignupAllowed("owner@example.com", "")).toBe(false);
  });
});
