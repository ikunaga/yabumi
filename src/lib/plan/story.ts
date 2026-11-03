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
