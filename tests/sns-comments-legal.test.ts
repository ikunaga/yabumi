// SNS のコメントに気付く版（docs/legal.md の「SNS のコメントに気付く版」。② として扱った。了承は 2026-11-14）: 版の並び・本文の新しい文。
// 施行日は本番に出す日に PM が合わせる（ここの日付も一緒に直す）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-15";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("SNS のコメントに気付く版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("プライバシーポリシーだけの版で、前もって知らせない理由があり、決まりを守っている", () => {
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.summary.join("")).toContain("コメント");
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
  });

  it("施行日（日本時間の 0 時）から今の版になる", () => {
    const at = new Date(`${VERSION}T00:00:00+09:00`);
    expect(currentLegalVersion(at)).toBe(VERSION);
    expect(currentLegalVersion(new Date(at.getTime() - 60_000))).not.toBe(VERSION);
  });

  it("本文に、預かるもの・使い道・送り先・保存期間・通知に入れないものを書き、DB の作りと合っている", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("書いた人の SNS の ID とプロフィール画像は預かりません");
    expect(privacy).toContain("コメントは AI には送りません");
    expect(privacy).toContain("投稿に付いたコメントの読み取り（コメントの権限つきでつないだとき）");
    expect(privacy).toContain("コメントの日時から 30 日で自動で消す");
    expect(privacy).toContain("コメントを書いた人の名前");
    const sql = read("supabase/migrations/20261114100000_sns_comments.sql");
    expect(sql).toContain("delete from public.sns_comments where commented_at < now() - interval '30 days'");
    expect(sql).toContain("social_account_id uuid not null references public.social_accounts (id) on delete cascade");
  });
});
