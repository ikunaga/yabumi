// AI の枠の帯の文（src/lib/ai/budget-status-text.ts）。金額は出さない。全体の上限は利用者のせいに見えない言い方
import { describe, expect, it } from "vitest";
import { AI_LOW_TEXT, aiBlockedText } from "@/lib/ai/budget-status-text";

describe("AI の枠の帯の文", () => {
  it("使えるときは帯を出さない", () => {
    expect(aiBlockedText({ status: "ok", availableFrom: null, low: true })).toBeNull();
    expect(AI_LOW_TEXT).toBe("今月 AI を使える量は、残りわずかです。来月 1 日に、また増えます。");
  });
  it("月の枠・登録して 7 日までの枠・全体の上限・1 日の上限で、いつから使えるかを出す", () => {
    expect(aiBlockedText({ status: "user_limit", availableFrom: "2026-12-01", low: false })).toBe("今月、AI を使える量を使い切りました。12 月 1 日から、また相談できます。これまでの相談は読めます。");
    expect(aiBlockedText({ status: "new_user_limit", availableFrom: "2026-11-28", low: false })).toBe("登録から 7 日間に使える AI の量を、使い切りました。11 月 28 日から、また相談できます。これまでの相談は読めます。");
    expect(aiBlockedText({ status: "global_limit", availableFrom: "2026-12-01", low: false })).toBe("yabumi を使う人みんなで、今月の AI の上限に達しました。あなたが使った量とは関係ありません。12 月 1 日から、また相談できます。これまでの相談は読めます。");
    expect(aiBlockedText({ status: "new_global_limit", availableFrom: "2026-11-28", low: false })).toBe("yabumi を使う人みんなで、今月の AI の上限に達しました。あなたが使った量とは関係ありません。11 月 28 日から、また相談できます。これまでの相談は読めます。");
    expect(aiBlockedText({ status: "daily_limit", availableFrom: "2026-11-22", low: false })).toBe("今日の AI の回数を使い切りました。明日から、また相談できます。これまでの相談は読めます。");
  });
  it("金額（円・ドル）は出さない", () => {
    for (const status of ["user_limit", "new_user_limit", "global_limit", "daily_limit"]) {
      expect(aiBlockedText({ status, availableFrom: "2026-12-01", low: false })).not.toMatch(/[円$＄]|ドル/);
    }
  });
});

it("ほかの画面では、できることの言葉を変えられる", () => {
  expect(aiBlockedText({ status: "daily_limit", availableFrom: "2026-11-22", low: false }, { can: "ネタを出せます" })).toBe("今日の AI の回数を使い切りました。明日から、またネタを出せます。");
});

it("「また」のあとが英字なら、間に空白を入れる", () => {
  expect(aiBlockedText({ status: "new_user_limit", availableFrom: "2026-11-28", low: false }, { can: "AI を使えます" })).toBe("登録から 7 日間に使える AI の量を、使い切りました。11 月 28 日から、また AI を使えます。");
});
