// 利用規約・プライバシーポリシーの版（決定 D31。src/lib/legal/version.ts）
import { describe, expect, it } from "vitest";
import {
  LEGAL_VERSIONS,
  type LegalRevision,
  currentLegalVersion,
  effectiveDateLabel,
  formatLegalDate,
  historyProblems,
  noticeStarted,
  publishedHistory,
  todayJst,
  upcomingLegalChange,
} from "@/lib/legal/version";

const base: LegalRevision = { version: "2026-10-12", docs: ["terms", "privacy"], summary: ["制定"], adverse: false, noticeFrom: null };
const next: LegalRevision = { version: "2026-11-20", docs: ["privacy"], summary: ["送り先に Google を足す"], adverse: false, noticeFrom: "2026-11-01" };
const history = [base, next];
const at = (iso: string) => new Date(iso);

describe("版の一覧（LEGAL_VERSIONS）", () => {
  it("いまの一覧が決まりを守っている（施行日の順、要約、知らせる期間）", () => {
    expect(historyProblems()).toEqual([]);
    expect(LEGAL_VERSIONS[0].version).toBe("2026-10-12");
  });

  it("知らせる期間が足りない・知らせ始める日がない・順が逆なら、問題として出す", () => {
    expect(historyProblems([base, { ...next, noticeFrom: "2026-11-10" }])[0]).toContain("14 日以上");
    expect(historyProblems([base, { ...next, adverse: true }])[0]).toContain("30 日以上");
    expect(historyProblems([base, { ...next, adverse: true, noticeFrom: "2026-10-21" }])).toEqual([]);
    expect(historyProblems([base, { ...next, noticeFrom: null }])[0]).toContain("noticeFrom");
    expect(historyProblems([next, base]).some((p) => p.includes("古い順"))).toBe(true);
  });
});

describe("今の版と予定の変更", () => {
  it("施行日の前は前の版、施行日（日本時間の 0 時）から新しい版になる", () => {
    // 2026-11-19 23:59 JST
    expect(currentLegalVersion(at("2026-11-19T14:59:00Z"), history)).toBe("2026-10-12");
    expect(upcomingLegalChange(at("2026-11-19T14:59:00Z"), history)?.version).toBe("2026-11-20");
    // 2026-11-20 00:00 JST
    expect(currentLegalVersion(at("2026-11-19T15:00:00Z"), history)).toBe("2026-11-20");
    expect(upcomingLegalChange(at("2026-11-19T15:00:00Z"), history)).toBeNull();
    expect(publishedHistory(at("2026-11-19T15:00:00Z"), history).map((r) => r.version)).toEqual(["2026-10-12", "2026-11-20"]);
  });

  it("知らせ始める日からだけ、お知らせを出す", () => {
    expect(noticeStarted(next, at("2026-10-31T14:59:00Z"))).toBe(false);
    expect(noticeStarted(next, at("2026-10-31T15:00:00Z"))).toBe(true);
  });

  it("施行日の表示と日本時間の日付", () => {
    expect(formatLegalDate("2026-10-12")).toBe("2026年10月12日");
    expect(effectiveDateLabel(at("2026-10-12T00:00:00Z"))).toBe("2026年10月12日");
    expect(todayJst(at("2026-10-12T15:30:00Z"))).toBe("2026-10-13");
  });
});
