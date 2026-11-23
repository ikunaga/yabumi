// 自動投稿の知らせをメールでも送る版（docs/legal.md の「自動投稿の知らせをメールでも送る版」。② として扱った。2026-11-23 オーナーが了承）:
// 版の並び・ポリシーの新しい文・作り（src/lib/auto-post/mail.ts）との一致。版は 2026-11-23（本番に出す日。誰も招待していないので noticeWaived）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-23";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("自動投稿の知らせをメールでも送る版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("プライバシーポリシーだけの版で、決まりを守っている", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-23");
    expect(rev.summary).toHaveLength(1);
    expect(rev.summary[0]).toContain("メールでも知らせる");
    expect(rev.summary[0]).toContain("投稿の本文は入れません");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
    expect(LEGAL_VERSIONS.some((r) => r.version === "2026-11-21")).toBe(true);
  });

  it("プライバシーポリシーに、設定・使い道・Resend の使い道と送るものを書いた", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("自動投稿の知らせを、スマホの通知とメールのそれぞれで受け取るかどうか");
    expect(privacy).toContain("確認待ちのまま送る時刻が近づいた投稿、自動投稿が止まったことと、また使えるようになったことは、スマホの通知とメールで知らせます（それぞれ「お知らせの設定」で止められます）");
    expect(privacy).toContain("メールは届いたメールの「自動投稿のメールを止める」からも止められます（止まるのは自動投稿のメールだけです）");
    expect(privacy).not.toContain("確認しないまま");
    expect(privacy).toContain("自動投稿の知らせのメールの送信（送らずに下書きに残した投稿、確認待ちの投稿、確認待ちのまま送る時刻が近づいた投稿、自動投稿が止まったことと、また使えるようになったこと）");
    expect(privacy).toContain("自動投稿の知らせのメールでは、プロジェクトの名前、自動投稿の設定の名前、送る日時、送り先の SNS の名前、止まった理由");
    expect(privacy).toContain("確認する画面のリンク。投稿の本文は入れません");
  });

  it("書いたことが作りに合っている（本文を入れない・運営者の理由を入れない・止められる・AUTO_POST_MAIL のときだけ）", () => {
    const mail = read("src/lib/auto-post/mail.ts");
    expect(mail).toContain("投稿の本文は入れない");
    expect(mail).toContain("理由は入れない");
    expect(mail).toContain('env.AUTO_POST_MAIL === "on"');
    expect(mail).toContain("auto_post_email");
    expect(mail).not.toMatch(/\bbody\b.*posts/);
  });
});
