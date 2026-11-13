// 整えた画像の元を預かる版（docs/legal.md の「整えた画像の元を預かる版」。② として扱った。了承は 2026-11-13）: 版の並び・1 日 1 版・本文の新しい文。
// 施行日は本番に出す日に PM が合わせる（ここの日付も一緒に直す）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, effectiveDateLabel, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-14";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("整えた画像の元を預かる版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("プライバシーポリシーだけの版で、前もって知らせない理由があり、決まりを守っている（1 日 1 版）", () => {
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.summary.join("")).toContain("元の画像");
    // シリーズ投稿と同じ日なので、1 つの版にまとめた
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
  });

  it("施行日（日本時間の 0 時）から今の版になり、プライバシーポリシーの施行日が変わる", () => {
    const at = new Date(`${VERSION}T00:00:00+09:00`);
    expect(currentLegalVersion(at)).toBe(VERSION);
    expect(currentLegalVersion(new Date(at.getTime() - 60_000))).not.toBe(VERSION);
    const [y, m, d] = VERSION.split("-").map(Number);
    expect(effectiveDateLabel(at, "privacy")).toBe(`${y}年${m}月${d}日`);
  });

  it("本文に、元の画像と整え方を預かること・同じ期間置いて一緒に消すことを書き、DB の作りと合っている", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("元の画像と整え方（見出しの文字・色、調整の値など）も預かります");
    expect(privacy).toContain("見出しを付けた・整えた画像の元の画像も、その画像と同じ期間置き、その画像を外したら一緒に消す");
    const sql = read("supabase/migrations/20261113150000_media_edit_source.sql");
    expect(sql).toContain("source_of uuid references public.media_files (id) on delete cascade");
    expect(sql).toContain("m.source_of is null and m.created_at < now() - interval '1 day'");
  });
});
