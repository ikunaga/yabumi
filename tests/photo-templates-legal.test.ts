// 2026-11-07 の版（絵の説明のフォーマットを預かる。docs/legal.md の ② の案）: 版の並び・1 日 1 版・本文の新しい文
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, effectiveDateLabel, historyProblems } from "@/lib/legal/version";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("2026-11-07 の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === "2026-11-07")!;

  it("最後に、プライバシーポリシーだけの版として足し、前もって知らせない理由があり、決まりを守っている（1 日 1 版）", () => {
    expect(LEGAL_VERSIONS.at(-1)).toBe(rev);
    expect(rev.docs).toEqual(["privacy"]);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS.filter((r) => r.version === "2026-11-07")).toHaveLength(1);
  });

  it("施行日から今の版になり、プライバシーポリシーの施行日だけが動く", () => {
    const at = new Date("2026-11-06T15:00:00Z");
    expect(currentLegalVersion(at)).toBe("2026-11-07");
    expect(effectiveDateLabel(at, "privacy")).toBe("2026年11月7日");
    expect(effectiveDateLabel(at, "terms")).toBe("2026年11月6日");
  });

  it("本文に、フォーマットを預かる・Anthropic に送る・保存期間の文がある。前の「絵の説明は保存しません」は、つくるときの説明の話として残す", () => {
    const privacy = read("src/app/privacy/page.tsx");
    expect(privacy).toContain("利用者が登録した絵の説明のフォーマット（名前と文。プロジェクトに 20 個、1 人 100 個まで）。画像をつくるときの絵の説明は保存しません");
    expect(privacy).toContain("AI でつくる画像の絵の説明の案を作るときの投稿の本文とアカウント設計、選んだ絵の説明のフォーマット");
    expect(privacy).toContain('["絵の説明のフォーマット", "利用者が消すか、プロジェクトを消すか、退会まで"]');
  });
});
