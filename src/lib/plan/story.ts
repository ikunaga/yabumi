import { STORY_FIELDS, sectionSchemas, type PlanData, type StoryField } from "./schema";

// あなたらしさ（story）とコンセプト（concept）を AI に渡す形（2026-11-03 オーナーの了承。docs/architecture.md の 4.50）。
// あなたらしさは、人生の背景や悩みなど個人的な内容なので、どの AI に何を渡すかをここだけで決める（storyForAi）。
// - 設計の相棒（coach）: まとめる（summary・strength の案を出す）ために、印のない項目も渡す。案の材料（柱・自己紹介文）には印のある項目だけを使うよう指示する
// - ネタ出し・整える・見直し・画像の案・相談: 「投稿に使ってよい」（shareable）の項目だけ

export type Story = PlanData["story"];

export const STORY_LABEL: Record<StoryField, string> = {
  why: "始めた思い",
  background: "背景・経験",
  struggle: "自分も抱えて乗り越えた悩み",
  strength: "ほかの人と違う強み",
  summary: "短いストーリー",
};

// AI の使い道。coach だけが印のない項目も受け取る
export const AI_USES = ["coach", "ideas", "tidy", "check", "image", "consult"] as const;
export type AiUse = (typeof AI_USES)[number];

export type StoryLine = { field: StoryField; label: string; text: string; shareable: boolean };

// 前の版の設計（story なし）や、前の形の値（文字列だけ）も読めるようにしてから使う
function storyOf(raw: unknown): Story {
  const parsed = sectionSchemas.story.safeParse(raw ?? {});
  return parsed.success ? parsed.data : sectionSchemas.story.parse({});
}

// その AI に渡してよい、あなたらしさの項目（中身のあるものだけ）
export function storyForAi(raw: unknown, use: AiUse): StoryLine[] {
  const story = storyOf(raw);
  return STORY_FIELDS.map((f) => ({ field: f, label: STORY_LABEL[f], text: story[f].text.trim(), shareable: story[f].shareable }))
    .filter((l) => l.text)
    .filter((l) => use === "coach" || l.shareable);
}

// 設計をそのまま JSON で渡す AI（相談）向け: あなたらしさを、その AI に渡してよい項目だけにした設計
export function planForAi(plan: PlanData, use: AiUse): PlanData {
  if (use === "coach") return plan;
  const keep = new Set(storyForAi(plan.story, use).map((l) => l.field));
  const story = Object.fromEntries(STORY_FIELDS.map((f) => [f, keep.has(f) ? plan.story[f] : { text: "", shareable: false }])) as Story;
  return { ...plan, story };
}

// コンセプトの 1 文（空なら ""）
export function conceptStatement(plan: Pick<PlanData, "concept">): string {
  return (plan.concept?.statement ?? "").trim();
}

// ネタ出し・整える・見直し・画像の案に足す行（コンセプトの 1 文と、投稿に使ってよいあなたらしさ）。どちらもなければ空
export function identityPromptLines(plan: PlanData, use: Exclude<AiUse, "coach">): string[] {
  const lines: string[] = [];
  const statement = conceptStatement(plan);
  if (statement) lines.push(`コンセプト（このアカウントは誰のどんな悩みをどう解決するか）: ${statement}`);
  const story = storyForAi(plan.story, use);
  if (story.length) {
    lines.push(
      "あなたらしさ（発信する人の思いや経験。利用者が「投稿に使ってよい」としたものだけ。ネタや文面に自然に生かしてよいが、誇張しない・ここにない経験や数字を足さない・毎回入れない）:",
      ...story.map((l) => `- ${l.label}: ${l.text}`),
    );
  }
  return lines;
}

// ===== AI の案を保存するときの「投稿に使ってよい」の印（セキュリティ確認 2026-11-06 の APP-L1） =====
// - 保存してある印のオフは残す（AI が印をオンに戻さない）。案のオフ（相手が「投稿に使わないで」と言った項目・AI が自分で入れた notShareable）も残す
// - 強み（strength）と短いストーリー（summary）は、ほかの項目をまとめた文なので、材料の中に「投稿に使わない」項目があるのに
//   新しい文に変わったら、オフの項目が混ざっているかもしれないので印をオフにする（画面で確かめてからオンにしてもらう。storyNeedsCheck）。
//   前と同じ文（利用者が確かめた文）なら、前の印のまま
// - 保存の共通の入口（lib/plan/save.ts の saveSectionValue）が、AI からの story に必ずかける（設計の相棒・相談のどちらから来ても）

// まとめた文と、その材料（strength は 3 項目、summary は strength も含めた 4 項目をまとめる）
const DERIVED_SOURCES: Partial<Record<StoryField, StoryField[]>> = {
  strength: ["why", "background", "struggle"],
  summary: ["why", "background", "struggle", "strength"],
};

function hasNotShareable(story: Story, fields: StoryField[]): boolean {
  return fields.some((f) => story[f].text.trim() !== "" && !story[f].shareable);
}

export function mergeStoryShareable(next: Story, prev: Story | null | undefined): Story {
  const merged = Object.fromEntries(
    // 保存してある会話の案は前の形のこともあるので、項目がなくても止まらないように読む
    STORY_FIELDS.map((f) => [f, { text: next?.[f]?.text ?? "", shareable: (next?.[f]?.shareable ?? true) && (prev?.[f]?.shareable ?? true) }]),
  ) as Story;
  // strength を先に決める（summary の材料に strength が入るため）
  for (const f of ["strength", "summary"] as const) {
    const changed = merged[f].text.trim() !== "" && merged[f].text !== (prev?.[f]?.text ?? "");
    if (changed && hasNotShareable(merged, DERIVED_SOURCES[f]!)) merged[f] = { ...merged[f], shareable: false };
  }
  return merged;
}

// 画面で「投稿に使ってよいか確かめてください」と出すか: まとめた文（strength・summary）がオフで、その材料に「投稿に使わない」項目があるとき
export function storyNeedsCheck(story: Story, field: StoryField): boolean {
  const sources = DERIVED_SOURCES[field];
  return Boolean(sources) && story[field].text.trim() !== "" && !story[field].shareable && hasNotShareable(story, sources!);
}
