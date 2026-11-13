// 読む人の悩み・望み（HARM。docs/architecture.md の 4.64）: 指示への入れ方・ネタの concern・見直しの誇張・用語集
import { describe, expect, it } from "vitest";
import { AI_CHECK_SYSTEM } from "@/lib/ai/ai-check";
import { CONTENT_RULES } from "@/lib/ai/content-rules";
import { CONSULT_SYSTEM } from "@/lib/ai/consult-prompt";
import { JAPANESE_STYLE_RULES } from "@/lib/ai/japanese-style";
import { PLAN_COACH_SYSTEM } from "@/lib/ai/plan-coach-prompt";
import { POST_IDEAS_SYSTEM, normalizeIdeas, readIdeasThread } from "@/lib/ai/post-ideas";
import { READER_CONCERNS, READER_CONCERNS_RULES, READER_CONCERN_LABEL, readerConcernOf } from "@/lib/ai/reader-concerns";
import { TIDY_DRAFT_SYSTEM } from "@/lib/ai/tidy-draft";
import { glossary } from "@/lib/glossary/terms";

const idea = (extra: Record<string, unknown> = {}) => ({ pillar: "仕込み", title: "朝の仕込み", angle: "家族の朝ごはんに", commits: [], notes: [], drafts: [{ sns: "x", text: "朝 5 時から焼いています" }], ...extra });

describe("指示への入れ方", () => {
  it("ネタ出し・相談・設計の相棒に入れ、書く中身の決まりのあと・日本語の決まりの前に置く", () => {
    for (const system of [POST_IDEAS_SYSTEM, CONSULT_SYSTEM]) {
      const at = system.indexOf(READER_CONCERNS_RULES);
      expect(at).toBeGreaterThan(system.indexOf(CONTENT_RULES));
      expect(at).toBeLessThan(system.indexOf(JAPANESE_STYLE_RULES));
    }
    expect(PLAN_COACH_SYSTEM.indexOf(READER_CONCERNS_RULES)).toBeGreaterThan(PLAN_COACH_SYSTEM.indexOf(CONTENT_RULES));
  });
  it("整えるには入れない（材料にない切り口を足さないため）", () => {
    expect(TIDY_DRAFT_SYSTEM).not.toContain(READER_CONCERNS_RULES);
    expect(TIDY_DRAFT_SYSTEM).not.toContain("HARM");
  });
  it("決まりの中身: 4 つ・書かれていない悩みを作らない・決めつけない・あおらない・効き目やもうけを約束しない", () => {
    for (const k of READER_CONCERNS) expect(READER_CONCERNS_RULES).toContain(k);
    expect(READER_CONCERNS_RULES).toContain("書かれていない悩みを作らない");
    expect(READER_CONCERNS_RULES).toContain("決めつけない");
    expect(READER_CONCERNS_RULES).toContain("あおらない");
    expect(READER_CONCERNS_RULES).toMatch(/約束したり、言い切ったりしない/);
  });
  it("ネタ出しは concern を選ばせ、設計の相棒は困りごとの答えの例に使う", () => {
    expect(POST_IDEAS_SYSTEM).toMatch(/concern には/);
    expect(PLAN_COACH_SYSTEM).toMatch(/困りごと（pain）を聞くときは/);
  });
  it("見直しの誇張に、あおる書き方と効き目・もうけの約束も入れる", () => {
    expect(AI_CHECK_SYSTEM).toContain("知らないと損");
    expect(AI_CHECK_SYSTEM).toContain("必ず痩せる");
  });
});

describe("ネタの concern", () => {
  it("4 つのどれかなら持ち、none は札を出さない（null）", () => {
    const r = normalizeIdeas({ ideas: [idea({ concern: "relationship" }), idea({ title: "お知らせ", concern: "none" })], questions: [] }, { knownShas: [], sns: ["x"] })!;
    expect(r.ideas.map((i) => i.concern)).toEqual(["relationship", null]);
  });
  it("前の版の返事（concern がない）も読める", () => {
    const r = normalizeIdeas({ ideas: [idea()], questions: [] }, { knownShas: [], sns: ["x"] })!;
    expect(r.ideas[0].concern).toBeNull();
  });
  it("保存してある前の版の案（concern がない）を読んでも、札は出ない", () => {
    const t = readIdeasThread("t", [
      { id: "1", role: "user", content: { kind: "ideas_request", source: "news", sns: ["x"] }, created_at: "2026-11-01T00:00:00Z" },
      { id: "2", role: "assistant", content: { kind: "ideas", ideas: [{ pillar: "", title: "前の案", angle: "", commits: [], drafts: [{ sns: "x", text: "a" }] }], questions: [] }, created_at: "2026-11-01T00:00:01Z" },
    ] as never)!;
    expect(readerConcernOf((t.latest.content as { ideas: { concern?: unknown }[] }).ideas[0].concern)).toBeNull();
  });
  it("知らない値は札を出さない", () => {
    expect(readerConcernOf("fear")).toBeNull();
    expect(readerConcernOf(undefined)).toBeNull();
    expect(readerConcernOf("money")).toBe("money");
    expect(READER_CONCERN_LABEL.relationship).toBe("人間関係");
  });
});

describe("用語集", () => {
  it("harm は 4 つの分類を表で持ち、ペルソナ・コンセプトとつながる", () => {
    const t = glossary.harm;
    const table = t.details?.find((d) => d.kind === "table");
    expect(table && table.kind === "table" ? table.rows.length : 0).toBe(4);
    expect(glossary.persona.related).toContain("harm");
    expect(glossary.concept.related).toContain("harm");
  });
});
