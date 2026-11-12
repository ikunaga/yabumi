// 投稿のフォーマットを預かる版（docs/legal.md の ② の案「投稿のフォーマットを預かる」。了承は 2026-11-10）: 版の並び・1 日 1 版・本文の新しい文。
// 施行日は本番に出す日に PM が合わせる（ここの日付も一緒に直す）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, effectiveDateLabel, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-11";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("投稿のフォーマットを預かる版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("最後に、プライバシーポリシーだけの版として足し、前もって知らせない理由があり、決まりを守っている（1 日 1 版）", () => {
    expect(LEGAL_VERSIONS.at(-1)).toBe(rev);
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.summary.join("")).toContain("投稿のフォーマット");
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
  });

  it("施行日（日本時間の 0 時）から今の版になり、プライバシーポリシーの施行日が変わる。利用規約の施行日は変わらない", () => {
    const at = new Date(`${VERSION}T00:00:00+09:00`);
    expect(currentLegalVersion(at)).toBe(VERSION);
    expect(currentLegalVersion(new Date(at.getTime() - 60_000))).not.toBe(VERSION);
    const [y, m, d] = VERSION.split("-").map(Number);
    expect(effectiveDateLabel(at, "privacy")).toBe(`${y}年${m}月${d}日`);
    expect(effectiveDateLabel(at, "terms")).toBe("2026年11月9日");
  });

  it("本文に、預かる・使い道・Anthropic に送る・保存期間の文がある。上限は DB とアプリと同じ", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("利用者が登録した、くり返し出す投稿の型（名前・いつ使うか・型の文・穴を埋めた例・つなげた投稿の柱の名前・毎回付けるハッシュタグ（全 SNS 共通と SNS ごと）。プロジェクトに 20 個、1 人 100 個まで）");
    expect(privacy).toContain("投稿のフォーマットの案を作ること");
    expect(privacy).toContain("選んだ投稿のフォーマットと穴に入れた言葉（案は保存しません）");
    expect(privacy).toContain("投稿のフォーマットを AI とつくるときは、プロジェクトとアカウント設計（書き方は送りません）");
    expect(privacy).toContain('["投稿のフォーマット", "利用者が消すか、プロジェクトを消すか、退会まで"]');
    const sql = read("supabase/migrations/20261110120000_post_formats.sql");
    expect(sql).toContain(">= 20 then");
    expect(sql).toContain(">= 100 then");
  });
});
