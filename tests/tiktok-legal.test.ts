// TikTok の連携の版（docs/legal.md の「TikTok の連携の版」。② として扱う）: 版の並び・本文の新しい文・作りとの一致。
// 了承は 2026-11-15（前もって知らせない）。動画・YouTube と 1 つの版（2026-11-16）にまとめ、2026-11-15 に本番に出して 2026-11-16 に施行する
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";
import { TICKET_TTL_MS } from "@/lib/sns/tiktok/media";

const VERSION = "2026-11-16";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("TikTok の連携の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("利用規約とプライバシーポリシーの版で、前もって知らせない理由があり、決まりを守っている", () => {
    expect(rev.docs).toEqual(["terms", "privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-15");
    expect(rev.summary.join("")).toContain("TikTok");
    expect(historyProblems()).toEqual([]);
    // 前の版（SNS のコメント）より後に並ぶ
    expect(LEGAL_VERSIONS.findIndex((r) => r.version === VERSION)).toBeGreaterThan(LEGAL_VERSIONS.findIndex((r) => r.version === "2026-11-15"));
  });

  it("プライバシーポリシーに、預かるもの・送り先・外国・保存期間・外し方を書き、作りと合っている", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("TikTok に送るときの設定と同意");
    expect(privacy).toContain("TikTok（TikTok Pte. Ltd.）");
    expect(privacy).toContain("TikTok が画像を取りに来るための、1 時間で切れる URL");
    expect(privacy).toContain("シンガポールには個人情報保護法（PDPA）があります");
    expect(privacy).toContain("1 時間で使えなくなり、送り終えたら消す（残ったものも毎日消す）");
    expect(privacy).toContain("https://www.tiktok.com/legal/page/row/privacy-policy/ja-JP");
    expect(privacy).toContain("TikTok に問い合わせて外されたことを確かめ");
    // 入口の期限は 1 時間（書いた文と同じ）
    expect(TICKET_TTL_MS).toBe(60 * 60 * 1000);
    // 同意の記録は配信先と一緒に消える（「送り先を消すか、投稿を消すか、退会まで」）
    const sql = read("supabase/migrations/20261114120000_tiktok.sql");
    expect(sql).toContain("post_target_id uuid primary key references public.post_targets (id) on delete cascade");
    expect(sql).toContain("owner_id uuid not null references auth.users (id) on delete cascade");
  });

  it("利用規約に、TikTok の規約・音楽の利用の確認・ブランドコンテンツのポリシーと、取り消せないことを書いた", () => {
    const terms = read("src/app/terms/page.tsx");
    expect(terms).toMatch(/Facebook ページ、TikTok(、YouTube)?）と GitHub/);
    expect(terms).toContain("https://www.tiktok.com/legal/page/global/music-usage-confirmation/en");
    expect(terms).toContain("https://www.tiktok.com/legal/page/global/bc-policy/ja-JP");
    expect(terms).toContain("https://www.tiktok.com/legal/page/row/terms-of-service/ja-JP");
    expect(terms).toContain("TikTok への投稿は、TikTok の仕組み上、本サービスからは取り消せません");
  });
});
