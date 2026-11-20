// 投稿のフォーマットの画像の版（docs/legal.md の「案: 投稿のフォーマットの画像」。オーナーの了承 2026-11-17）: 版の要約・1 日 1 版・本文の新しい文。
// 自動の投稿の版（2026-11-17【仮】）と同じ日に出す前提で、その版にまとめた。施行日は本番に出す日に PM が合わせる（ここの日付も一緒に直す）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-17";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("投稿のフォーマットの画像の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("版の要約に画像の文があり、プライバシーポリシーが変わる版で、前もって知らせない理由があり、決まりを守っている（1 日 1 版）", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toContain("privacy");
    expect(rev.adverse).toBe(false);
    expect(rev.summary.filter((line) => line.includes("投稿のフォーマットに画像の設定"))).toHaveLength(1);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
  });

  it("本文に、預かる・Anthropic に送る・Google に送るの新しい文がある", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("画像の設定（絵の説明の文・絵の説明のつくり方・写真かイラストか・縦横・重ねる見出しの文・見出しの上に重ねる小さい文・見出しの見た目〈色・書体・置き方〉）");
    expect(privacy).toContain("投稿のフォーマットの画像をつくるときは、そのフォーマットの絵の説明と、空欄に入れた言葉・シリーズの答え");
    expect(privacy).toContain("投稿のフォーマットの画像では、空欄に入れた言葉やシリーズの答えが入ることがあります");
    expect(privacy).toContain("投稿の本文そのもの・画像・プロジェクトの名前・利用者の名前は送りません");
    expect(privacy).not.toContain("投稿の本文・画像・プロジェクトの名前・利用者の名前は送りません");
  });
});
