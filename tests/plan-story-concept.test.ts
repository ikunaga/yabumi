// アカウント設計の「あなたらしさ」（story）と「コンセプト」（concept）（docs/architecture.md の 4.50）。本物の AI は呼ばない
import { describe, expect, it } from "vitest";
import { buildAiCheckRequest } from "@/lib/ai/ai-check";
import { CONSULT_SYSTEM, consultContextMessage, type ConsultContext } from "@/lib/ai/consult-prompt";
import { normalizeConsultTurn } from "@/lib/ai/consult-schema";
import { buildImageBriefRequest } from "@/lib/ai/image-brief";
import { buildPhotoIdeasRequest } from "@/lib/ai/photo";
import { coachContextMessage, PLAN_COACH_SYSTEM } from "@/lib/ai/plan-coach-prompt";
import { mergeStoryShareable, normalizeCoachTurn, storySummaryNeedsCheck, toSectionValue, toWireTurn, toWireValue } from "@/lib/ai/plan-coach-schema";
import { buildNewsIdeasRequest, buildPlanIdeasRequest, hasPlanMaterial, type IdeaContext } from "@/lib/ai/post-ideas";
import { PLAN_EXAMPLES, PRODUCT_GUIDES } from "@/lib/ai/product-guide";
import { buildTidyRequest } from "@/lib/ai/tidy-draft";
import { addConceptHintClosed, parseConceptHintCookie } from "@/lib/plan/concept-hint";
import { describeSection } from "@/lib/plan/describe";
import { REQUIRED_FOR_DONE, SECTION_KEYS, isPlanDone, isSectionDone, normalizePlan, parseSectionForm, sectionNumber, sectionSchemas, type PlanData } from "@/lib/plan/schema";
import { AI_USES, identityPromptLines, planForAi, storyForAi } from "@/lib/plan/story";
import { PRODUCT_TYPES } from "@/lib/projects/product-types";

// 背景（background）だけ「投稿に使ってよい」をオフにした設計
const SECRET = "前の会社で体を壊して休職した";
const SHARED = "家計簿を 5 回挫折した";
const plan = normalizePlan(
  {
    goal: { what: "家計簿アプリ", goalType: "awareness", note: "" },
    story: {
      why: { text: SHARED, shareable: true },
      background: { text: SECRET, shareable: false },
      summary: { text: "続かなかった自分のために作った", shareable: true },
    },
    audience: { pain: "何に使ったかわからない", where: "" },
    concept: { how: "撮るだけで記録", statement: "家計簿が続かない会社員の悩みを、撮るだけで解決するアプリ" },
    pillars: { items: [{ name: "作っている様子", share: 50, example: "" }], tone: "です・ます調", avoid: "" },
  },
  "28 歳の会社員",
);

const textOf = (req: { messages: { content: unknown }[] }) => (req.messages[0].content as { text: string }[])[0].text;

describe("前に保存した設計（story・concept がない形）", () => {
  it("2 つがない設計も、空として読める。済みの判定は 3 つのまま変わらない", () => {
    const old = normalizePlan({ goal: { what: "a", goalType: "awareness", note: "" }, pillars: { items: [{ name: "柱" }] } }, "会社員");
    expect(old.story.why).toEqual({ text: "", shareable: true });
    expect(old.concept).toEqual({ how: "", statement: "" });
    expect(isSectionDone("story", old.story)).toBe(false);
    expect(isSectionDone("concept", old.concept)).toBe(false);
    // コンセプトを入れると、もう設計を終えた人が「済んでいない」に戻るので入れない（4.50）
    expect(REQUIRED_FOR_DONE).toEqual(["goal", "audience", "pillars"]);
    expect(isPlanDone(old)).toBe(true);
  });

  it("あなたらしさの前の形（文字列だけ）も、印はオンとして読む。壊れた値はセクションを空にする", () => {
    expect(normalizePlan({ story: { why: "自分が困った" } }, "").story.why).toEqual({ text: "自分が困った", shareable: true });
    expect(normalizePlan({ story: { why: { text: 1 } } }, "").story.why).toEqual({ text: "", shareable: true });
  });

  it("どちらか 1 つ書けば記入済み（あなたらしさはどれか 1 項目、コンセプトは 1 文）", () => {
    expect(isSectionDone("story", sectionSchemas.story.parse({ strength: { text: "朝 4 時から仕込む" } }))).toBe(true);
    expect(isSectionDone("concept", { how: "撮るだけ", statement: " " })).toBe(false);
    expect(isSectionDone("concept", { how: "", statement: "1 文" })).toBe(true);
  });
});

describe("項目の番号と並び", () => {
  it("あなたらしさは目的のあと、コンセプトは届けたい相手のあと。番号は 1〜10", () => {
    expect(SECTION_KEYS.indexOf("story")).toBe(SECTION_KEYS.indexOf("goal") + 1);
    expect(SECTION_KEYS.indexOf("concept")).toBe(SECTION_KEYS.indexOf("audience") + 1);
    expect(sectionNumber("goal")).toBe(1);
    expect(sectionNumber("profile")).toBe(8);
    expect(sectionNumber("first_month")).toBe(10);
  });

  it("相棒への指示の番号も、画面と同じ並び", () => {
    for (const k of SECTION_KEYS) expect(PLAN_COACH_SYSTEM, k).toContain(`${sectionNumber(k)}. ${k} `);
  });
});

describe("画面の欄", () => {
  it("あなたらしさは、文と「投稿に使ってよい」（オフのときは送られない）", () => {
    const form = new FormData();
    form.set("why", "自分が困って作った");
    form.set("why-shareable", "on");
    form.set("background", SECRET);
    const v = parseSectionForm("story", form);
    expect(v.success).toBe(true);
    expect(v.data?.why).toEqual({ text: "自分が困って作った", shareable: true });
    expect(v.data?.background).toEqual({ text: SECRET, shareable: false });
    expect(v.data?.summary).toEqual({ text: "", shareable: false });
  });

  it("コンセプトは How と 1 文だけ（Who・What は届けたい相手のもの）。1 文は 200 字まで", () => {
    const form = new FormData();
    form.set("how", "撮るだけ");
    form.set("statement", "あ".repeat(201));
    expect(parseSectionForm("concept", form).success).toBe(false);
    form.set("statement", "1 文");
    expect(parseSectionForm("concept", form).data).toEqual({ how: "撮るだけ", statement: "1 文" });
  });

  it("どの種類にも、あなたらしさとコンセプトの記入例と、相棒が聞くときの選択肢がある", () => {
    for (const t of PRODUCT_TYPES) {
      const ex = PLAN_EXAMPLES[t];
      for (const v of [...Object.values(ex.story), ex.concept.how, ex.concept.statement]) expect(v, t).not.toBe("");
      expect(ex.story.summary.length, t).toBeLessThanOrEqual(300);
      expect(PRODUCT_GUIDES[t].storyChoices.length, t).toBeGreaterThanOrEqual(2);
      expect(PRODUCT_GUIDES[t].storyExample, t).toMatch(/^例: /);
    }
  });
});

describe("あなたらしさを AI に渡す範囲（storyForAi）", () => {
  it("設計の相棒には全部、ほかの AI には「投稿に使ってよい」ものだけ", () => {
    expect(storyForAi(plan.story, "coach").map((l) => l.field)).toEqual(["why", "background", "summary"]);
    for (const use of AI_USES.filter((u) => u !== "coach")) {
      expect(storyForAi(plan.story, use).map((l) => l.field), use).toEqual(["why", "summary"]);
    }
    // 前の形・壊れた値でも止まらない
    expect(storyForAi(undefined, "ideas")).toEqual([]);
    expect(storyForAi({ why: 3 }, "ideas")).toEqual([]);
  });

  it("planForAi は相棒以外で、印のない項目を空にする", () => {
    expect(planForAi(plan, "coach")).toBe(plan);
    const p = planForAi(plan, "consult");
    expect(p.story.background.text).toBe("");
    expect(p.story.why.text).toBe(SHARED);
    expect(p.pillars).toBe(plan.pillars);
  });

  const ideaCtx: IdeaContext = { project: { name: "かけいぼ日和", description: "", targetAudience: "28 歳の会社員", productType: "app" }, plan, sns: ["x"] };
  const checkCtx = { projectName: "かけいぼ日和", plan, productType: "app" as const, sns: ["x" as const] };
  const consultCtx: ConsultContext = {
    today: "2026-11-03",
    project: { name: "かけいぼ日和", description: "", appStoreUrl: null, playStoreUrl: null, productType: "app" },
    plan,
    connectedSns: [],
    manualSns: [],
    recentPosts: [],
    kpiNumbers: [],
    goals: { active: null, past: [], candidates: [] },
    roadmap: { items: [] },
  };
  const sent: [string, string][] = [
    ["ネタ出し（設計から）", textOf(buildPlanIdeasRequest(ideaCtx))],
    ["ネタ出し（最近のできごと）", textOf(buildNewsIdeasRequest(ideaCtx, [{ question: "q", answer: "a" }]))],
    ["整える", textOf(buildTidyRequest(ideaCtx, "下書き"))],
    ["見直し", textOf(buildAiCheckRequest(checkCtx, [{ sns: "x", text: "本文" }]))],
    ["画像の文字の案", textOf(buildImageBriefRequest(checkCtx, "本文"))],
    ["AI の画像の絵の説明の案", textOf(buildPhotoIdeasRequest(checkCtx, "本文"))],
    ["相談", consultContextMessage(consultCtx)],
  ];

  it.each(sent)("%s: コンセプトの 1 文と、投稿に使ってよいあなたらしさだけを渡す", (_, text) => {
    expect(text).toContain(SHARED);
    expect(text).toContain("家計簿が続かない会社員の悩みを、撮るだけで解決するアプリ");
    expect(text).not.toContain(SECRET);
  });

  it("設計の相棒には、印のない項目も印つきで渡す（まとめるため）", () => {
    const text = coachContextMessage({ project: { name: "かけいぼ日和", description: "", appStoreUrl: null, playStoreUrl: null, productType: "app" }, plan, sources: {}, focus: "story" });
    expect(text).toContain(SECRET);
    expect(text).toContain('"shareable":false');
    // 種類ごとの「始めたきっかけ」の選択肢と例
    expect(text).toContain(PRODUCT_GUIDES.app.storyChoices[0]);
    expect(PLAN_COACH_SYSTEM).toContain("話したくないことは飛ばして大丈夫");
    expect(PLAN_COACH_SYSTEM).toContain("shareable が true の項目だけ");
  });

  it("あなたらしさもコンセプトもなければ、何も足さない（前と同じ）", () => {
    expect(identityPromptLines(normalizePlan({}, ""), "ideas")).toEqual([]);
    const off = normalizePlan({ story: { why: { text: SECRET, shareable: false } } }, "");
    expect(identityPromptLines(off, "check")).toEqual([]);
    expect(textOf(buildPlanIdeasRequest({ ...ideaCtx, plan: off }))).not.toContain(SECRET);
  });

  it("コンセプトだけでも、ネタ出しの材料になる", () => {
    const only = normalizePlan({ concept: { how: "", statement: "1 文のコンセプト" } }, "");
    expect(hasPlanMaterial({ ...ideaCtx, project: { ...ideaCtx.project, targetAudience: "" }, plan: only })).toBe(true);
  });

  it("相談の AI は、あなたらしさを直す案を出せない（渡していない項目が消えるため）", () => {
    expect(CONSULT_SYSTEM).toContain("あなたらしさ（story）は直さない");
    const turn = (section: string) =>
      normalizeConsultTurn({
        message: "案です",
        choices: [],
        proposal: { kind: "plan_section", options: [{ title: "a", summary: "", pros: [], cons: [], value_json: JSON.stringify({ section, value: { how: "h", statement: "s" } }) }], recommended: 0, reason: "" },
      });
    expect(turn("story")?.proposal).toBeNull();
    expect(turn("concept")?.proposal?.options).toHaveLength(1);
  });
});

describe("設計の相棒の案", () => {
  const coachTurn = (section: string, value: unknown) => ({
    message: "案です",
    choices: [],
    proposal: { section, options: [{ title: "a", summary: "", pros: [], cons: [], value_json: JSON.stringify(value) }], recommended: 0, reason: "r" },
  });

  it("あなたらしさの案を読み取る（notShareable の項目は印をオフ、ほかはオン）", () => {
    const t = normalizeCoachTurn(coachTurn("story", { why: "困って作った", background: SECRET, struggle: "", strength: "続かない人の気持ちがわかる", summary: "まとめ", notShareable: ["background"] }));
    const v = t?.proposal?.options[0].value as PlanData["story"];
    expect(v.why).toEqual({ text: "困って作った", shareable: true });
    expect(v.background).toEqual({ text: SECRET, shareable: false });
    expect(v.struggle).toEqual({ text: "", shareable: true });
    // 履歴として渡すときは、もとの形に戻す
    expect(toWireValue("story", v)).toEqual({ why: "困って作った", background: SECRET, struggle: "", strength: "続かない人の気持ちがわかる", summary: "まとめ", notShareable: ["background"] });
    const wire = toWireTurn({ message: "m", choices: [], proposal: t!.proposal }) as { proposal: { options: { value_json: string }[] } };
    expect(JSON.parse(wire.proposal.options[0].value_json).notShareable).toEqual(["background"]);
  });

  it("項目が足りない案・長すぎる案", () => {
    const short = normalizeCoachTurn(coachTurn("story", { summary: "まとめだけ" }));
    expect((short?.proposal?.options[0].value as PlanData["story"]).summary.text).toBe("まとめだけ");
    expect(normalizeCoachTurn(coachTurn("story", { summary: "あ".repeat(301) }))?.proposalProblem).toContain("長すぎる");
  });

  it("コンセプトの案を読み取る", () => {
    const t = normalizeCoachTurn(coachTurn("concept", { how: "撮るだけ", statement: "1 文" }));
    expect(t?.proposal?.options[0].value).toEqual({ how: "撮るだけ", statement: "1 文" });
    expect(toSectionValue("concept", { statement: "あ".repeat(201) })).toBeNull();
  });

  it("採用するとき、保存してある「投稿に使ってよい」のオフは残す（AI がオンに戻さない）", () => {
    const next = toSectionValue("story", { why: "a", background: "b", summary: "c" }) as PlanData["story"];
    const merged = mergeStoryShareable(next, plan.story);
    expect(merged.background).toEqual({ text: "b", shareable: false });
    expect(merged.why.shareable).toBe(true);
    // 前の形の案（項目がない）でも止まらない
    expect(() => mergeStoryShareable({} as PlanData["story"], undefined)).not.toThrow();
  });

  it("「投稿に使わない」項目があるのに短いストーリーが新しい文に変わったら、短いストーリーもオフにして確かめてもらう（L1）", () => {
    const next = toSectionValue("story", { why: "a", background: "b", summary: "背景をまとめた新しい文" }) as PlanData["story"];
    const merged = mergeStoryShareable(next, plan.story);
    expect(merged.summary).toEqual({ text: "背景をまとめた新しい文", shareable: false });
    expect(storySummaryNeedsCheck(merged)).toBe(true);
    // 案のほうで「投稿に使わない」とした項目（notShareable）があっても同じ
    const fromAi = toSectionValue("story", { why: "a", struggle: "話したくない", summary: "まとめ", notShareable: ["struggle"] }) as PlanData["story"];
    expect(mergeStoryShareable(fromAi, undefined).summary.shareable).toBe(false);
    // AI が summary を自分で notShareable に入れたときもオフ
    expect((toSectionValue("story", { why: "a", summary: "まとめ", notShareable: ["summary"] }) as PlanData["story"]).summary.shareable).toBe(false);
    // オフの項目がなければ、オンのまま。前と同じ文（利用者が確かめた文）なら、前の印のまま
    expect(mergeStoryShareable(toSectionValue("story", { why: "a", summary: "まとめ" }) as PlanData["story"], undefined).summary.shareable).toBe(true);
    const checked = { ...merged, summary: { text: merged.summary.text, shareable: true } };
    expect(mergeStoryShareable(next, checked).summary.shareable).toBe(true);
    expect(storySummaryNeedsCheck(checked)).toBe(false);
  });

  it("保存してある会話の案は、前の形（項目がない・文字列だけ・値がない）でも表示で止まらない", () => {
    expect(() => describeSection("story", undefined as never)).not.toThrow();
    expect(toWireValue("story", undefined as never)).toEqual({ why: "", background: "", struggle: "", strength: "", summary: "", notShareable: [] });
    expect(() => describeSection("concept", undefined as never)).not.toThrow();
    expect(describeSection("story", { why: "困って作った", background: { text: SECRET, shareable: false } } as never)).toEqual([
      { label: "始めた思い", text: "困って作った" },
      { label: "背景・経験（投稿に使わない）", text: SECRET },
    ]);
    expect(describeSection("concept", { statement: "1 文" } as never)).toEqual([{ label: "コンセプト", text: "1 文" }]);
  });
});

describe("概要の「コンセプトを決める」を閉じた記録（cookie）", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  it("プロジェクトの id だけを、新しい順に覚える。形の違う値は捨てる", () => {
    expect(parseConceptHintCookie(undefined)).toEqual([]);
    expect(parseConceptHintCookie(`${a},<script>,${b}`)).toEqual([a, b]);
    expect(addConceptHintClosed(a, b)).toBe(`${b},${a}`);
    expect(addConceptHintClosed(`${b},${a}`, a)).toBe(`${a},${b}`);
  });
});
