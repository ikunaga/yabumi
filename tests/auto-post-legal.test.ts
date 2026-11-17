// 自動の投稿の版（docs/legal.md の「案: 自動の投稿」。② として扱った。了承は 2026-11-17）: 版の並び・本文の新しい文・作りとの一致。
// 版の日付は本番に出す日に PM が合わせる。合わせるときは src/lib/legal/version.ts の version とこの VERSION を一緒に直す
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, historyProblems } from "@/lib/legal/version";

const VERSION = "2026-11-17";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("自動の投稿の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === VERSION)!;

  it("利用規約とプライバシーポリシーの版で、決まりを守っている", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toEqual(["terms", "privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("2026-11-17");
    expect(rev.noticeWaived).not.toContain("【仮】");
    expect(rev.summary).toHaveLength(2);
    expect(rev.summary[0]).toContain("自動の投稿");
    expect(rev.summary[0]).toContain("プライバシーポリシー");
    expect(rev.summary[1]).toContain("利用規約");
    expect(historyProblems()).toEqual([]);
    // 1 日 1 版で、2026-11-16 の版（TikTok・動画・YouTube）より後
    expect(LEGAL_VERSIONS.filter((r) => r.version === VERSION)).toHaveLength(1);
    expect(LEGAL_VERSIONS.at(-1)!.version >= VERSION).toBe(true);
    expect(LEGAL_VERSIONS.some((r) => r.version === "2026-11-16")).toBe(true);
  });

  it("プライバシーポリシーに、預かる情報・使い道・Anthropic に送るもの・通知・保存期間を書いた", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain('"自動の投稿",');
    expect(privacy).toContain("承認したときの文の指紋（元の文には戻せない値）");
    expect(privacy).toContain("X・TikTok・YouTube は、利用者が中身を見て承認したものだけを送ります");
    expect(privacy).toContain("自動の投稿の文を作り確かめること");
    expect(privacy).toContain("利用者がその場で押していないときにも、設定した曜日と時刻の前に送ります");
    // 通知には投稿の本文を入れない（送り先の SNS と時刻など）
    expect(privacy).toContain("自動の投稿の知らせでは、送り先の SNS と時刻・件数、設定の名前と止めた理由");
    expect(privacy).toContain('["自動の投稿の設定", "利用者が消すか、プロジェクトを消すか、退会まで"]');
    expect(privacy).toContain('"自動の回の記録・承認の記録", "13 か月で自動で消す');
    expect(privacy).toContain('"お知らせ・季節の予定", "その日付から 1 年で自動で消す');
  });

  it("保存期間の文が、片付けのジョブと消え方に合っている", () => {
    const sql = read("supabase/migrations/20261116120000_auto_post_engine.sql");
    expect(sql).toContain("yabumi-purge-auto-post");
    expect(sql).toContain("delete from public.auto_runs where created_at < now() - interval '13 months'");
    expect(sql).toContain("delete from public.post_target_approvals where approved_at < now() - interval '13 months'");
    expect(sql).toContain("delete from public.project_events where on_date < (now() at time zone 'Asia/Tokyo')::date - 365");
    // 設定・プロジェクト・退会で一緒に消える
    const core = read("supabase/migrations/20261116100000_auto_post.sql");
    expect(core).toContain("references public.auto_plans (id) on delete cascade");
    expect(core).toContain("references public.projects (id) on delete cascade");
    expect(core).toContain("references auth.users (id) on delete cascade");
    // お知らせ・季節の予定の中身は 100 字まで
    expect(core).toContain("body text not null check (char_length(btrim(body)) between 1 and 100)");
  });

  it("利用規約に、できること・自動の投稿の決まりと責任・止めることを書いた", () => {
    const terms = read("src/app/terms/page.tsx");
    expect(terms).toContain("決めた曜日と時刻に AI が投稿を作って送る（自動の投稿）");
    expect(terms).toContain("自動で送ることに同意したときだけ動きます");
    expect(terms).toContain("自動の投稿で送った投稿の内容と結果の責任は、利用者にあります");
    expect(terms).toContain("自動の投稿を止めることがあります");
  });
});
