// シリーズ投稿の版（docs/legal.md の ② の案「シリーズ投稿」。オーナーの了承待ち）: 版の並び・1 日 1 版・本文の新しい文。
// 施行日は本番に出す日に PM が合わせる（ここの日付も一緒に直す）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, historyProblems } from "@/lib/legal/version";
import { MAX_ROUNDS } from "@/lib/post-formats/series";

const VERSION = "2026-11-14";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("シリーズ投稿の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("最後に、プライバシーポリシーだけの版として足し、前もって知らせない理由があり、決まりを守っている（1 日 1 版）", () => {
    expect(LEGAL_VERSIONS.at(-1)).toBe(rev);
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.summary.join("")).toContain("シリーズの記録");
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
  });

  it("施行日（日本時間の 0 時）から今の版になる", () => {
    const at = new Date(`${VERSION}T00:00:00+09:00`);
    expect(currentLegalVersion(at)).toBe(VERSION);
    expect(currentLegalVersion(new Date(at.getTime() - 60_000))).not.toBe(VERSION);
  });

  it("本文に、預かる・使い道・Anthropic に送る・保存期間の文がある。上限は DB とアプリと同じ", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("シリーズの設定（AI が埋める穴と、本文に出さない答えの名前、それぞれの AI への指示）");
    expect(privacy).toContain("回ごとの答えと穴の言葉（シリーズの記録。本文に入れたとき・利用者が貼ったとき。1 つのフォーマットに 300 回、1 人 3,000 回まで）");
    expect(privacy).toContain("シリーズの次の回の案を作ること");
    expect(privacy).toContain("シリーズの記録（新しい 100 回の答えと穴の言葉）");
    expect(privacy).toContain("投稿のフォーマット（シリーズの記録を含む）");
    const sql = read("supabase/migrations/20261113140000_format_series.sql");
    expect(sql).toContain(`>= ${MAX_ROUNDS} then`);
    expect(sql).toContain(">= 3000 then");
  });
});
