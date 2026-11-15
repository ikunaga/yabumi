// 投稿に動画を添える版（docs/legal.md の「投稿に動画を添える版」。② として扱う）: 版の並び・本文の新しい文が、作り（DB・決まり）と合っていること。
// 了承は 2026-11-15（前もって知らせず、本番に出す日を施行日にする）。施行日は本番に出す日に PM が合わせる（ここの日付も一緒に直す）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, historyProblems } from "@/lib/legal/version";
import { KEEP_VIDEO_AFTER_FAILED_DAYS, KEEP_VIDEO_AFTER_SENT_DAYS } from "@/lib/media/video-rules";
import { SNS } from "@/lib/sns";

const VERSION = "2026-11-17";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("投稿に動画を添える版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("利用規約とプライバシーポリシーの版で、決まりを守っている", () => {
    expect(rev.docs).toEqual(["terms", "privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-15");
    expect(rev.summary.join("")).toContain("動画");
    expect(historyProblems()).toEqual([]);
    expect(currentLegalVersion(new Date(`${VERSION}T00:00:00+09:00`))).toBe(VERSION);
  });

  it("預かるもの・送り先・保存期間が、作りと合っている", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("撮影の場所・日時・機種などの情報は、利用者の端末で形をそろえるときに取り除き");
    expect(privacy).toContain(`すべての送り先に送り終えて ${KEEP_VIDEO_AFTER_SENT_DAYS} 日（送れなかった送り先が残っていれば ${KEEP_VIDEO_AFTER_FAILED_DAYS} 日）`);
    // 送り先に書いた SNS だけが、動画を送れる（X は W2 の確かめのあとで足す）
    for (const sns of ["threads", "instagram", "facebook"] as const) expect(SNS[sns].video).toBe(true);
    expect(SNS.x.video).toBe(false);
    expect(privacy).toContain("Threads が画像や動画を取りに来るための");
    expect(privacy).toContain("Instagram が画像や動画を取りに来るための");
    expect(privacy).toContain("Facebook が画像や動画を取りに来るための");
    const sql = read("supabase/migrations/20261115100000_post_videos.sql");
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("interval '13 months'");
    const terms = read("src/app/terms/page.tsx");
    expect(terms).toContain("写っている人の同意を得ていない動画");
  });
});
