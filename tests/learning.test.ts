// 学びの表示（4.47）: 今日の用語の選び方（純粋な関数）と、ひとことの決まり
import { describe, expect, it } from "vitest";
import { GLOSSARY_KEYS, glossary } from "@/lib/glossary/terms";
import { pickTodayTerm, SITUATION_TERMS, type LearningSignals } from "@/lib/learning/today-term";
import { hasUrl, isTipTrigger, tipByKey, TIP_TRIGGERS, TIPS } from "@/lib/learning/tips";

const none: LearningSignals = { planIncomplete: false, usedShortLink: false, hasRoadmap: false, connectedInstagram: false };
const keys = ["persona", "conversion", "kgi", "kpi", "contentPillar", "toneAndManner", "marketingFunnel", "snsTraits", "hashtag"];

describe("今日の用語の選び方", () => {
  it("状況に合う語を、まだ読んでいない語から（状況の並び → 語の並び）", () => {
    expect(pickTodayTerm({ keys, reads: [], signals: { ...none, planIncomplete: true } })).toBe("persona");
    expect(pickTodayTerm({ keys, reads: [{ key: "persona", lastReadAt: "2026-11-01T00:00:00Z" }], signals: { ...none, planIncomplete: true } })).toBe("contentPillar");
    expect(pickTodayTerm({ keys, reads: [], signals: { ...none, usedShortLink: true } })).toBe("marketingFunnel");
    expect(pickTodayTerm({ keys, reads: [], signals: { ...none, hasRoadmap: true } })).toBe("kgi");
    expect(pickTodayTerm({ keys, reads: [], signals: { ...none, connectedInstagram: true } })).toBe("snsTraits");
    // 設計がまだのほうが先
    expect(pickTodayTerm({ keys, reads: [], signals: { ...none, hasRoadmap: true, planIncomplete: true } })).toBe("persona");
  });

  it("状況の語を全部読んでいたら、次の状況、なければまだ読んでいない語を用語集の順に", () => {
    const read = (k: string[]) => k.map((key) => ({ key, lastReadAt: "2026-11-01T00:00:00Z" }));
    expect(pickTodayTerm({ keys, reads: read(["persona", "contentPillar", "toneAndManner"]), signals: { ...none, planIncomplete: true, hasRoadmap: true } })).toBe("kgi");
    expect(pickTodayTerm({ keys, reads: read(["persona", "contentPillar", "toneAndManner"]), signals: { ...none, planIncomplete: true } })).toBe("conversion");
    expect(pickTodayTerm({ keys, reads: [], signals: none })).toBe("persona");
  });

  it("全部読んだら、読んだのが古い順（同じ日時なら用語集の順）", () => {
    const reads = keys.map((key, i) => ({ key, lastReadAt: `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00Z` }));
    reads[4] = { key: "contentPillar", lastReadAt: "2026-09-01T00:00:00Z" };
    expect(pickTodayTerm({ keys, reads, signals: { ...none, planIncomplete: true } })).toBe("contentPillar");
    const same = keys.map((key) => ({ key, lastReadAt: "2026-10-01T00:00:00Z" }));
    expect(pickTodayTerm({ keys, reads: same, signals: none })).toBe("persona");
  });

  it("用語集にない語（状況の語・読んだ記録）は使わない", () => {
    expect(pickTodayTerm({ keys: ["kgi", "kpi"], reads: [{ key: "gone", lastReadAt: "2026-01-01T00:00:00Z" }], signals: { ...none, planIncomplete: true } })).toBe("kgi");
    expect(pickTodayTerm({ keys: [], reads: [], signals: none })).toBeNull();
  });

  it("状況の語は、どれも用語集にある", () => {
    for (const s of SITUATION_TERMS) for (const k of s.keys) expect(GLOSSARY_KEYS).toContain(k);
  });
});

describe("ひとこと", () => {
  const all = Object.values(TIPS).flat();

  it("どのきっかけにも 1 つ以上。結びつけた用語は用語集にある", () => {
    for (const t of TIP_TRIGGERS) expect(TIPS[t].length).toBeGreaterThan(0);
    for (const tip of all) expect(GLOSSARY_KEYS).toContain(tip.term);
  });

  it("文は 2 文まで。同じ key は同じ文（きっかけをまたいで同じひとことを使うとき）。key は DB の形に合う", () => {
    for (const tip of all) {
      expect(tip.text.split("。").filter((x) => x.trim()).length).toBeLessThanOrEqual(2);
      expect(tip.key).toMatch(/^[A-Za-z0-9_]{1,64}$/);
      expect(tipByKey(tip.key)!.text).toBe(tip.text);
    }
  });

  it("文の中の用語（カタカナ・英字の専門用語）は、用語集にあるものだけ", () => {
    const labels = Object.values(glossary).map((g) => g.label);
    const jargon = ["ロードマップ", "KPI", "短縮リンク", "コンバージョン", "インプレッション", "投稿の柱", "ペルソナ"];
    for (const j of jargon) expect(labels).toContain(j);
    for (const tip of all) for (const word of ["KGI", "CTR", "エンゲージメント", "リーチ", "CV"]) expect(tip.text).not.toContain(word);
  });

  it("きっかけの名前と、URL があるかの判定", () => {
    expect(isTipTrigger("post_scheduled")).toBe(true);
    expect(isTipTrigger("drop table")).toBe(false);
    expect(hasUrl("詳しくは https://example.com で")).toBe(true);
    expect(hasUrl("example.com")).toBe(false);
  });
});
