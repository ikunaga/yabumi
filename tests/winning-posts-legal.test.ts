// 伸びた投稿からの提案の版（docs/legal.md の「伸びた投稿からの提案の版」。② として扱い、2026-11-20 にオーナーが了承）: 版の並び・1 日 1 版・本文の新しい文。
// 施行日は 2026-11-20 で確定。同じ日のほかの ② の変更はこの版にまとめるので、要約は「含む」で確かめる
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SOURCE_POSTS, SOURCE_POST_CHARS } from "@/lib/post-formats/from-posts";
import { LEGAL_VERSIONS, currentLegalVersion, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-20";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("伸びた投稿からの提案の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("版があり、要約に伸びた投稿の文があり、前もって知らせない理由があり、決まりを守っている（1 日 1 版）", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toContain("privacy");
    expect(rev.adverse).toBe(false);
    expect(rev.summary.some((line) => line.includes("伸びた自分の投稿"))).toBe(true);
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

  it("本文に、使い道と Anthropic・Resend に送るものの文がある。件数と字数はアプリと同じ", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("投稿のフォーマットの案を作ること（いつもより伸びた自分の投稿から作ることを含む）");
    expect(privacy).toContain(`利用者が選んだ自分の送信済みの投稿の本文（${MAX_SOURCE_POSTS} 件まで、1 件 ${SOURCE_POST_CHARS} 字まで）`);
    expect(privacy).toContain("倍率だけで、数字そのものは送りません。X から読んだ数字は使いません");
    expect(privacy).toContain("いつもより伸びた自分の投稿があれば、その本文の 1 行目〈40 字まで〉と、いつもの何倍か");
  });
});
