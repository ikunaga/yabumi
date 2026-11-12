// PMO の通しテストで見つかった 4 件（fix/walkthrough-2）: X の月の上限を送る前に出す・Threads のトピック・AI のチェックが利用者のタグや仕掛けの言葉を消させない・AI の案で共通の本文を残す
import { describe, expect, it } from "vitest";
import { AI_CHECK_SYSTEM } from "@/lib/ai/ai-check";
import { adoptTidyOption, type TidyOption } from "@/lib/ai/tidy-draft-apply";
import { problemsByStep } from "@/lib/posts/compose-steps";
import { PREVIEW, threadsTopic } from "@/lib/sns/preview";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";
import { X_BY_HAND_MESSAGE, inLaterJstMonth, jstMonth, judgeXSend, xOverMessage, xSendCostUsd } from "@/lib/sns/x/send-rules";

describe("X の月の上限（送信ジョブの reserve_sns_spend と同じ比べ方）", () => {
  const base = { userSpentUsd: 0, totalSpentUsd: 0, costUsd: X_PRICE_USD.post_with_url, userBudgetUsd: 1, budgetUsd: 3 };
  it("今月の額 ＋ この投稿 が上限を超えるときだけ当たる（ちょうど上限は送れる）", () => {
    expect(judgeXSend({ ...base, userSpentUsd: 0.8 })).toBeNull();
    expect(judgeXSend({ ...base, userSpentUsd: 0.81 })).toBe("user");
    expect(judgeXSend({ ...base, totalSpentUsd: 2.81 })).toBe("global");
  });
  it("利用者ごとの上限を先に見る（両方に当たるときは user）。上限がなければ当たらない", () => {
    expect(judgeXSend({ ...base, userSpentUsd: 1, totalSpentUsd: 3 })).toBe("user");
    expect(judgeXSend({ ...base, userSpentUsd: 9, totalSpentUsd: 9, userBudgetUsd: null, budgetUsd: null })).toBeNull();
  });
  it("費用は送信ジョブと同じ（URL があると $0.20、説明文のある画像 1 枚ごとに足す）", () => {
    expect(xSendCostUsd("本文", 0)).toBe(X_PRICE_USD.post);
    expect(xSendCostUsd("本文 https://example.com", 2)).toBeCloseTo(X_PRICE_USD.post_with_url + 2 * X_PRICE_USD.media_metadata);
  });
  it("全体の上限の文は、1 人の上限の額もほかの人の額も書かない", () => {
    const g = xOverMessage("global", { costUsd: 0.2, userBudgetUsd: 1 });
    expect(g).toContain("yabumi 全体の X の上限");
    expect(g).not.toMatch(/\$|1 人/);
    expect(xOverMessage("user", { costUsd: 0.2, userBudgetUsd: 1 })).toBe("今月の X の自動投稿の上限（1 人 $1）に達するので、この投稿は X に自動では送れません（この投稿 $0.20）");
  });
  it("月の区切りは日本時間。11/30 23:59（JST）は同じ月、12/1 0:00（JST）からは後の月", () => {
    const now = new Date("2026-11-20T03:00:00Z");
    expect(jstMonth(new Date("2026-11-30T14:59:00Z"))).toBe("2026-11");
    expect(jstMonth(new Date("2026-11-30T15:00:00Z"))).toBe("2026-12");
    expect(inLaterJstMonth(new Date("2026-11-30T14:59:00Z"), now)).toBe(false);
    expect(inLaterJstMonth(new Date("2026-11-30T15:00:00Z"), now)).toBe(true);
    // 日本時間の月初（UTC ではまだ前の月）も、日本時間で数える
    expect(inLaterJstMonth(new Date("2026-11-30T16:00:00Z"), new Date("2026-11-30T14:00:00Z"))).toBe(true);
  });
  it("上限に当たるのは ② で直す問題", () => {
    expect(problemsByStep({ issues: [], xBudget: "X: 上限", noTargets: false, missingConnect: [], reconnect: [], needsTime: false })).toEqual([{ step: 2, text: "X: 上限" }]);
  });
  it("手で投稿する印の文は、送信の結果の「X に手で投稿する」に案内する", () => {
    expect(X_BY_HAND_MESSAGE).toContain("X に手で投稿する");
  });
});

describe("Threads のトピック（実際の投稿に合わせる）", () => {
  it("本文の 1 つ目のハッシュタグがトピックになり、本文では # が外れる。2 つ目からは文字のまま", () => {
    expect(threadsTopic("連想映画クイズ\n\n#個人開発 #indiedev")).toEqual({ topic: "個人開発", text: "連想映画クイズ\n\n個人開発 #indiedev" });
    expect(threadsTopic("タグなし")).toEqual({ topic: null, text: "タグなし" });
    // 文字の続きの # や &#123; はタグではない
    expect(threadsTopic("C#とF# &#123; #本物")).toEqual({ topic: "本物", text: "C#とF# &#123; 本物" });
  });
  it("見え方の説明も、トピックと 2 つ目からの扱いを書く", () => {
    expect(PREVIEW.threads.note).toContain("トピック");
    expect(PREVIEW.threads.note).toContain("2 つ目からはタグにならず");
  });
});

describe("AI のチェックが、利用者のタグや仕掛けの言葉を消させない", () => {
  it("本文のタグは利用者が選んだもの。設計の候補にないことだけでは指摘せず、設計のタグに置き換えない", () => {
    expect(AI_CHECK_SYSTEM).toContain("候補にないことだけでは指摘しない");
    expect(AI_CHECK_SYSTEM).toContain("設計のタグを足す・置き換える fix は出さない");
    expect(AI_CHECK_SYSTEM).not.toContain("設計のタグに置き換えるのはよい");
    expect(AI_CHECK_SYSTEM).not.toContain("アカウント設計の「ハッシュタグ」にないタグ（設計で決めたタグがあるとき）");
  });
  it("クイズのキーワードなど、わざと入れた言葉は消す直しを出さず、気になる点を伝えるだけ", () => {
    expect(AI_CHECK_SYSTEM).toContain("クイズのヒントやキーワードの並び");
    expect(AI_CHECK_SYSTEM).toContain("消す・別の言葉に置き換える・減らす fix は出さない");
    expect(AI_CHECK_SYSTEM).toContain("fix は空文字にする（直すかどうかは利用者が決める）");
  });
});

describe("AI の案を使っても、共通の本文は残す", () => {
  const option: TidyOption = {
    label: "型のまま出す",
    why: "",
    drafts: [
      { sns: "x", text: "連想映画クイズ\n答えはリプで" },
      { sns: "instagram", text: "連想映画クイズ\n答えはコメントで\n#映画クイズ" },
    ],
  };
  it("SNS で違う案は、すべて SNS ごとの文面に入り、本文の欄には Instagram の文やタグが入らない", () => {
    const next = adoptTidyOption(option, { body: "利用者の本文", overrides: {} });
    expect(next.body).toBe("利用者の本文");
    expect(next.overrides).toEqual({ x: "連想映画クイズ\n答えはリプで", instagram: "連想映画クイズ\n答えはコメントで\n#映画クイズ" });
  });
});
