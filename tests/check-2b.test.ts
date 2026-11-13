// 「。」のばらつき（fix/check-2b。本物の AI での確かめで、題名・キーワードの並び・問いかけの行のせいで「。」がないと指摘された）:
// 題名の行・言葉を並べた行・問いかけの行・タグの行は文として数えない。AI のチェックの指示・書く側の日本語の決まり・プログラムの検出をそろえる
import { describe, expect, it } from "vitest";
import { AI_CHECK_SYSTEM } from "@/lib/ai/ai-check";
import { JAPANESE_STYLE_RULES, periodExempt, styleProblems } from "@/lib/ai/japanese-style";

const keys = (text: string) => styleProblems(text, {}).map((p) => p.key);

describe("「。」のばらつきで文として数えない行", () => {
  it("AI のチェックの指示に、数えない行と、それだけで指摘しないことを書いた", () => {
    expect(AI_CHECK_SYSTEM).toContain("題名の行・言葉を並べた行・問いかけの行（？で終わる行や、？のあとに短い案内が続く行）・タグの行は文として数えない");
    expect(AI_CHECK_SYSTEM).toContain("「。」のない行があっても、それだけで指摘しない");
  });
  it("書く側の日本語の決まりも同じ行を除く（食い違わない）", () => {
    expect(JAPANESE_STYLE_RULES).toContain("題名の行、言葉を並べた行、問いかけの行（？で終わる行や、？のあとに「答えはリプで」のような短い案内が続く行）は文として数えない");
  });
  it("プログラムの検出: 題名・キーワードの並び・問いかけの行は数えない", () => {
    expect(periodExempt("連想映画クイズ", 0, 3)).toBe(true);
    expect(periodExempt("時計台・稲妻・スケートボード・1985年・タイムマシン", 1, 3)).toBe(true);
    expect(periodExempt("この 5 つから連想する映画は？答えはリプで", 2, 3)).toBe(true);
    // 1 行だけの投稿の 1 行目、長い行、「、」のある行は題名と見なさない
    expect(periodExempt("連想映画クイズ", 0, 1)).toBe(false);
    expect(periodExempt("金曜の朝だけ、カンパーニュを焼いています", 0, 2)).toBe(false);
  });
  it("PMO の通しテストの投稿では「。」の混ざりを出さない。ふつうの文の混ざりは、いままでどおり出す", () => {
    const quiz = "連想映画クイズ\n時計台・稲妻・スケートボード・1985年・タイムマシン\nこの 5 つから連想する映画は？答えはリプで\n\n#個人開発 #アプリ開発";
    expect(keys(quiz)).not.toContain("period_mix");
    expect(keys("新メニュー\n栗のタルトを焼きました。\n11 月 15 日から並びます。")).not.toContain("period_mix");
    expect(keys("金曜に焼きます。\n朝 9 時から並びます")).toContain("period_mix");
  });
});
