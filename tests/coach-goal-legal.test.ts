// 伴走の毎週の振り返りに目標の数字を入れる版（docs/legal.md の「伴走の毎週の振り返りに目標の数字を入れる版」。② として扱った。2026-11-19 PM の判断）:
// 版の並び・ポリシーの新しい文・作り（src/lib/coach/messages.ts）との一致。
// 版は 2026-11-20 で確定（実装担当3 の「伸びた投稿からの提案の版」と 1 つの版。2026-11-20 オーナーの了承）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-20";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("伴走の毎週の振り返りに目標の数字を入れる版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("プライバシーポリシーだけの版で、決まりを守っている", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-19");
    expect(rev.noticeWaived).not.toContain("【仮】");
    expect(rev.summary.some((s) => s.includes("伴走の毎週の振り返り") && s.includes("目標の進み具合"))).toBe(true);
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
    expect(LEGAL_VERSIONS.some((r) => r.version === "2026-11-18")).toBe(true);
  });

  it("ポリシーの push サービスに送るものに書き、作りに合っている（通知には目標の文を入れず数字だけ）", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("毎週の振り返りでは目標の数字（いまの数と目標の値。届かない見込みのときはそのこと）");
    // メール（Resend）の本文には目標の文も入るので、Resend の行にも書く
    expect(privacy).toContain("毎週の振り返りでは、目標（KGI）の文と数字〈いまの数・目標の値・このままの見込み。届かない見込みのときは、そのことと届くのに要るペース〉");
    // 同じ日の版（伸びた投稿から）と 1 つにまとめた
    expect(rev.summary.some((s) => s.includes("伸びた自分の投稿"))).toBe(true);
    const messages = read("src/lib/coach/messages.ts");
    expect(messages).toContain("目標は数字だけ（ロック画面に出るので、目標の文は入れない）");
  });
});
