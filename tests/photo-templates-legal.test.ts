// 2026-11-09 の版（了承は 2026-11-07。本番に出す日に付け直した。絵の説明のフォーマットを預かる。docs/legal.md の ② の案）: 版の並び・1 日 1 版・本文の新しい文
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, effectiveDateLabel, historyProblems } from "@/lib/legal/version";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("2026-11-09 の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === "2026-11-09")!;

  it("利用規約とプライバシーポリシーの両方の版として足し、前もって知らせない理由があり、決まりを守っている（1 日 1 版）", () => {
    expect(rev).toBeDefined();
    expect(rev.docs).toEqual(["terms", "privacy"]);
    // プロジェクトの数を縛るので、利用者に不利な変更
    expect(rev.adverse).toBe(true);
    expect(rev.summary).toContain("プロジェクトは 1 人 10 個まで作れるようにしました（利用規約の『料金と上限』）。");
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === "2026-11-09")).toHaveLength(1);
  });

  it("施行日から今の版になり、利用規約とプライバシーポリシーの施行日が 2026年11月9日 になる", () => {
    const at = new Date("2026-11-08T15:00:00Z");
    expect(currentLegalVersion(at)).toBe("2026-11-09");
    expect(effectiveDateLabel(at, "privacy")).toBe("2026年11月9日");
    expect(effectiveDateLabel(at, "terms")).toBe("2026年11月9日");
    expect(effectiveDateLabel(new Date("2026-11-08T14:59:00Z"), "terms")).toBe("2026年11月6日");
  });

  it("利用規約の「料金と上限」に、プロジェクトの数の上限の文があり、値は DB とアプリの上限と同じ 10", () => {
    expect(read("src/app/terms/page.tsx")).toContain("プロジェクトは、1 人 10 個まで作れます。10 個に達したら、使っていないプロジェクトを消すと、新しく作れます。");
    expect(read("supabase/migrations/20261107130000_project_limit.sql")).toContain("c_max_projects constant integer := 10;");
  });

  // 2026-11-21 に絵の説明のフォーマットをなくした（① として扱った。docs/legal.md）。預かる・送る・保存期間の文を消し、前に使った絵の説明の出し方を書き足した
  it("絵の説明のフォーマットをなくしたので、預かる・Anthropic に送る・保存期間の文がない。つくるときの説明は保存しない、は残す", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).not.toContain("絵の説明のフォーマット");
    expect(privacy).toContain("画像をつくるときの絵の説明は保存しません");
    expect(privacy).toContain("「前に使った絵の説明」として本人にだけ出します");
    expect(read("supabase/migrations/20261121170000_drop_photo_prompt_templates.sql")).toContain("drop table public.photo_prompt_templates;");
  });
});
