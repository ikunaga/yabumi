// YouTube の連携の版（docs/legal.md の「案: YouTube の連携」。② として扱った。了承は 2026-11-15。施行日は本番に出す日に PM が合わせる〈ここの日付も一緒に直す〉）: 版の並び・本文の新しい文・作りとの一致。
// YouTube API Services の開発者ポリシーが求める文（API を使うこと・Google のプライバシーポリシー・取り消し方・YouTube 利用規約）が入っていること
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";
import { EXPIRED_PURGE_DAYS } from "@/lib/sns/youtube/purge";

const VERSION = "2026-11-17";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("YouTube の連携の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("利用規約とプライバシーポリシーの版で、決まりを守っている", () => {
    expect(rev.docs).toEqual(["terms", "privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-15");
    expect(rev.noticeWaived).not.toContain("【仮】");
    expect(rev.summary.join("")).toContain("YouTube API サービス");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.at(-1)?.version).toBe(VERSION);
  });

  it("プライバシーポリシーに、YouTube API サービス・Google のプライバシーポリシー・取り消し方・預かるもの・保存期間を書き、作りと合っている", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("YouTube API サービスを使います");
    expect(privacy).toContain("https://www.google.com/policies/privacy");
    expect(privacy).toContain("https://security.google.com/settings/security/permissions");
    expect(privacy).toContain("YouTube に送るときの設定と同意");
    expect(privacy).toContain("YouTube（Google LLC）");
    expect(privacy).toContain("30 日以内");
    // 期限切れのまま 30 日たつ前に消す（毎日のジョブで、1 日の余裕）
    expect(EXPIRED_PURGE_DAYS).toBeLessThan(30);
    // 同意の記録と途中の情報は、配信先と一緒に消える（「送り先を消すか、投稿を消すか」）
    const sql = read("supabase/migrations/20261115110000_youtube.sql");
    expect(sql).toContain("post_target_id uuid primary key references public.post_targets (id) on delete cascade");
    expect(sql).toContain("owner_id uuid not null references auth.users (id) on delete cascade");
  });

  it("利用規約に、YouTube 利用規約と、利用者が選ぶもの・直したり消したりしないことを書いた", () => {
    const terms = read("src/app/terms/page.tsx");
    expect(terms).toContain("TikTok、YouTube）と GitHub");
    expect(terms).toContain("https://www.youtube.com/t/terms");
    expect(terms).toContain("上げた動画を直したり消したりはしません");
  });
});
