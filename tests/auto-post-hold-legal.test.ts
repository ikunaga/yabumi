// 運営者が自動の投稿を止めた記録の版（docs/legal.md の「運営者が自動の投稿を止めた記録の版」。② として扱った。了承は 2026-11-18）:
// 版の並び・ポリシーの新しい文・作り（20261118100000_auto_post_holds）との一致。
// 版は 2026-11-18（本番に出す日。2026-11-18 オーナーがデプロイを了承）。src/lib/legal/version.ts の version と同じ
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-18";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("運営者が自動の投稿を止めた記録の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("プライバシーポリシーだけの版で、決まりを守っている", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-18");
    expect(rev.noticeWaived).not.toContain("【仮】");
    expect(rev.summary).toHaveLength(1);
    expect(rev.summary[0]).toContain("運営者が利用者ごとに自動の投稿を止めた記録");
    expect(historyProblems()).toEqual([]);
    // 1 日 1 版で、施行済みの 2026-11-17 の版より後
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
    expect(LEGAL_VERSIONS.at(-1)!.version >= VERSION).toBe(true);
    expect(LEGAL_VERSIONS.some((r) => r.version === "2026-11-17")).toBe(true);
  });

  it("プライバシーポリシーに、預かる情報・使い道・通知・保存期間を書いた", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain('"運営者が自動投稿を止めた記録",');
    expect(privacy).toContain("止められている本人は、止められた日時を画面で見られます（運営者のメモは見せません）");
    expect(privacy).toContain("運営者が利用者ごとに自動投稿を止め、その記録を残すことを含みます");
    expect(privacy).toContain("運営者が自動投稿を止めた・解除したこと（運営者の理由は入れません）");
    expect(privacy).toContain('["運営者が自動投稿を止めた記録", "退会まで');
  });

  it("書いたことが作りに合っている（退会で消える・本人は日時だけ読める・通知に理由を入れない）", () => {
    const sql = read("supabase/migrations/20261118100000_auto_post_holds.sql");
    expect(sql).toContain("user_id uuid not null references auth.users (id) on delete cascade");
    expect(sql).toContain("grant select (id, user_id, held_at, released_at) on public.auto_post_holds to authenticated;");
    const holds = read("src/lib/auto-post/holds.ts");
    expect(holds).toContain('body: "運営者が、あなたのアカウントの自動投稿を止めました。くわしくは問い合わせ先へ"');
    // 利用規約は変えない（「利用の停止」の条に、運営者が自動の投稿を止めることと、画面と通知で知らせることが書いてある）
    const terms = read("src/app/terms/page.tsx");
    expect(terms).toContain("自動投稿を止めることがあります。止めたときは画面と通知で知らせます");
  });
});
