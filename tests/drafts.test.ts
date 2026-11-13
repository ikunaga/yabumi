// 下書きの決め方と、下書きの一覧の 1 行の題（src/lib/posts/drafts.ts。2026-11-13 PMO2 の確かめ）
import { describe, expect, it } from "vitest";
import { draftHeadline, isUnsentDraft } from "@/lib/posts/drafts";

describe("下書き（まだどこにも送っていない）", () => {
  it("予約していない・送り先がどれもまだのものだけ。今すぐ送った投稿（draft のまま送られる）は入れない", () => {
    expect(isUnsentDraft({ status: "draft", targetStatuses: [] })).toBe(true);
    expect(isUnsentDraft({ status: "draft", targetStatuses: ["pending", "pending"] })).toBe(true);
    expect(isUnsentDraft({ status: "draft", targetStatuses: ["pending", "published"] })).toBe(false);
    expect(isUnsentDraft({ status: "draft", targetStatuses: ["failed"] })).toBe(false);
    expect(isUnsentDraft({ status: "scheduled", targetStatuses: ["pending"] })).toBe(false);
  });
});

describe("一覧の 1 行の題", () => {
  const base = { overrides: [], titles: [], images: 0 };
  it("本文を 1 行にまとめる（長さは画面で 2 行まで出して「…」）", () => {
    expect(draftHeadline({ ...base, body: "連想映画クイズ\n時計台・稲妻\n\n答えはリプで" })).toEqual({ text: "連想映画クイズ 時計台・稲妻 答えはリプで", empty: false });
  });
  it("本文が空なら SNS ごとの文面・題、なければ画像の枚数か「（本文なし）」", () => {
    expect(draftHeadline({ ...base, body: "  ", overrides: [null, "X だけの文"] })).toEqual({ text: "X だけの文", empty: false });
    expect(draftHeadline({ ...base, body: "", titles: ["YouTube の題"] })).toEqual({ text: "YouTube の題", empty: false });
    expect(draftHeadline({ ...base, body: "", images: 2 })).toEqual({ text: "画像 2 枚（本文なし）", empty: true });
    expect(draftHeadline({ ...base, body: "" })).toEqual({ text: "（本文なし）", empty: true });
  });
});
