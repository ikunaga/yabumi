// PMO のローカルでの確かめ（fix/check-2）: AI のチェックが、利用者のタグを中身との関係や数で否定しない・整えるが利用者の書いたタグを残す指示
import { describe, expect, it } from "vitest";
import { AI_CHECK_SYSTEM } from "@/lib/ai/ai-check";
import { TIDY_DRAFT_SYSTEM } from "@/lib/ai/tidy-draft";

describe("AI のチェックのタグの指摘（案 B。タグは AI に送らないまま、指示を直す）", () => {
  it("中身と関係のないタグの決まりと例（#個人開発 など）を消した", () => {
    expect(AI_CHECK_SYSTEM).not.toContain("関係のないタグ");
    expect(AI_CHECK_SYSTEM).not.toContain("#個人開発");
    expect(AI_CHECK_SYSTEM).not.toContain("#飲食店経営");
  });
  it("数の決まりは、送れない Instagram の 6 個以上だけ。Threads・X・Facebook の数は指摘しない", () => {
    expect(AI_CHECK_SYSTEM).toContain("Instagram で 6 個以上");
    expect(AI_CHECK_SYSTEM).not.toMatch(/Threads で 2 つ以上|X で 3 つ以上|Facebook で 3 つ以上/);
    expect(AI_CHECK_SYSTEM).toContain("ほかの SNS の数は指摘しない");
  });
  it("宣伝のためだけのタグと、本文の途中に並べたタグの指摘は残す", () => {
    expect(AI_CHECK_SYSTEM).toContain("宣伝のためだけのタグ（#拡散希望 #相互フォロー など）");
    expect(AI_CHECK_SYSTEM).toContain("本文の途中に並べたタグ");
  });
  it("本文のタグは利用者が選んだもの。関係や設計の候補では指摘せず、置き換えない", () => {
    expect(AI_CHECK_SYSTEM).toContain("投稿の中身と関係があるか、アカウント設計の「ハッシュタグ」の候補にあるかでは指摘しない");
    expect(AI_CHECK_SYSTEM).toContain("設計のタグを足す・置き換える fix は出さない");
  });
});

describe("AI が投稿を書く側（整える）も、利用者のタグを外さない", () => {
  it("元の文とフォーマットに利用者が書いたタグは、設計になくても残す", () => {
    expect(TIDY_DRAFT_SYSTEM).toContain("利用者が書いたタグは、利用者が選んだもの。設計にないタグでも、外したり別のタグに置き換えたりせず");
  });
});
