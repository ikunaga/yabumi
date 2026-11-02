import { z } from "zod";

// AI で投稿に整えるの「整え方」（docs/architecture.md の 4.34）。口調・長さ・ねらい・絵文字・ほかに一言を、利用者が選べる。
// 何も選ばなければ今までと同じ（アカウント設計の口調どおり、おまかせ）。選び方は毎回の材料（利用者のメッセージ）に入れ、指示（system）は変えない。
// 画面とサーバーの両方で使う（サーバーは受け取った値をここで確かめ直す）

export const MAX_DIRECTION_NOTE = 100;

type Choice<K extends string> = { key: K; label: string; hint: string };

export const TIDY_TONES = [
  { key: "plan", label: "設計どおり", hint: "アカウント設計の口調のまま" },
  { key: "polite", label: "ていねい", hint: "です・ます調で、きちんと" },
  { key: "casual", label: "くだけた", hint: "友だちに話すように、やわらかく" },
  { key: "passionate", label: "熱を込めて", hint: "思いが伝わるように、言い切って" },
  { key: "calm", label: "落ち着いて", hint: "淡々と、静かに" },
] as const satisfies readonly Choice<string>[];

export const TIDY_LENGTHS = [
  { key: "short", label: "短く", hint: "ひと目で読める長さに" },
  { key: "normal", label: "ふつう", hint: "SNS ごとの目安の字数で" },
  { key: "long", label: "じっくり", hint: "上限の中で、くわしく" },
] as const satisfies readonly Choice<string>[];

export const TIDY_AIMS = [
  { key: "auto", label: "おまかせ", hint: "元の文に合わせて" },
  { key: "awareness", label: "知ってもらう", hint: "まず名前や中身を覚えてもらう" },
  { key: "action", label: "やってもらう", hint: "行き先に行く・買う・予約など、設計の「してほしいこと」へ" },
  { key: "empathy", label: "共感してもらう", hint: "気持ちや体験に「わかる」と思ってもらう" },
  { key: "question", label: "問いかけて反応をもらう", hint: "答えたくなる問いで、返事をもらう" },
] as const satisfies readonly Choice<string>[];

export const TIDY_EMOJIS = [
  { key: "auto", label: "設計どおり", hint: "設計の口調どおり（決めていなければ使わない）" },
  { key: "none", label: "なし", hint: "絵文字を使わない" },
  { key: "some", label: "少し", hint: "1〜2 個まで" },
] as const satisfies readonly Choice<string>[];

type KeyOf<T extends readonly { key: string }[]> = T[number]["key"];
const keys = <T extends readonly { key: string }[]>(list: T) => list.map((c) => c.key) as [KeyOf<T>, ...KeyOf<T>[]];

export const tidyDirectionSchema = z.object({
  tone: z.enum(keys(TIDY_TONES)).catch("plan"),
  length: z.enum(keys(TIDY_LENGTHS)).catch("normal"),
  aim: z.enum(keys(TIDY_AIMS)).catch("auto"),
  emoji: z.enum(keys(TIDY_EMOJIS)).catch("auto"),
  note: z.string().catch(""),
});

export type TidyDirection = z.infer<typeof tidyDirectionSchema>;

export const DEFAULT_DIRECTION: TidyDirection = { tone: "plan", length: "normal", aim: "auto", emoji: "auto", note: "" };

// 改行・制御文字は空白にし、前後の空白を落として 100 字まで
export function cleanNote(note: string): string {
  return [...note.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].slice(0, MAX_DIRECTION_NOTE).join("");
}

// 受け取った値を確かめる（形が合わなければ、その項目は「おまかせ」に）
export function parseDirection(raw: unknown): TidyDirection {
  const parsed = tidyDirectionSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  const d = parsed.success ? parsed.data : DEFAULT_DIRECTION;
  return { ...d, note: cleanNote(d.note) };
}

export function isDefaultDirection(d: TidyDirection): boolean {
  return d.tone === "plan" && d.length === "normal" && d.aim === "auto" && d.emoji === "auto" && d.note === "";
}

const labelOf = <T extends readonly Choice<string>[]>(list: T, key: string) => list.find((c) => c.key === key)!.label;

// ボタンの横に出す、選んだものの短いまとめ（例: 「ていねい・短く・一言あり」）。何も選んでいなければ null
export function directionSummary(d: TidyDirection): string | null {
  const parts = [
    d.tone !== "plan" ? labelOf(TIDY_TONES, d.tone) : null,
    d.length !== "normal" ? labelOf(TIDY_LENGTHS, d.length) : null,
    d.aim !== "auto" ? labelOf(TIDY_AIMS, d.aim) : null,
    d.emoji !== "auto" ? `絵文字${labelOf(TIDY_EMOJIS, d.emoji)}` : null,
    d.note ? "一言あり" : null,
  ].filter(Boolean);
  return parts.length ? parts.join("・") : null;
}

const TONE_TEXT: Record<TidyDirection["tone"], string | null> = {
  plan: null,
  polite: "ていねいに（です・ます調で、きちんと）。アカウント設計の口調より、こちらを優先する",
  casual: "くだけた口調で（友だちに話すように、やわらかく）。アカウント設計の口調より、こちらを優先する",
  passionate: "熱を込めて（思いが伝わるように、言い切る）。ただし誇張や感嘆符の重ねすぎはしない。アカウント設計の口調より、こちらを優先する",
  calm: "落ち着いた口調で（淡々と、静かに）。アカウント設計の口調より、こちらを優先する",
};

const LENGTH_TEXT: Record<TidyDirection["length"], string | null> = {
  short: "短く。SNS ごとの目安の字数より短めにし、言いたいことだけを残す",
  normal: null,
  long: "じっくり。上限の中で、目安より長くてよい（元の文にあることだけで、くわしく書く。足りなければ無理に伸ばさない）",
};

const AIM_TEXT: Record<TidyDirection["aim"], string | null> = {
  auto: null,
  awareness: "知ってもらう。名前や中身を覚えてもらうことを第一にし、行動を促す一言は入れない",
  action: "やってもらう。最後に、プロジェクトの「見た人にしてほしいこと」へ自然に促す一言を添えてよい（URL・値段・期限など、元の文にないことは書かない）",
  empathy: "共感してもらう。元の文にある気持ちや体験を軸にして、読む人が「わかる」と思える形にする",
  question: "問いかけて反応をもらう。最後を、読む人が答えたくなる問いにする",
};

const EMOJI_TEXT: Record<TidyDirection["emoji"], string | null> = {
  auto: null,
  none: "絵文字を使わない",
  some: "絵文字を 1〜2 個まで使ってよい（アカウント設計のやらないことに絵文字があれば使わない）",
};

const escapeNote = (s: string) => s.replace(/<(\/?)(direction_note)\b/gi, "<$1$2_");

// 利用者のメッセージに入れる「# 整え方」。何も選んでいなければ空（今までと同じ材料）
export function directionText(d: TidyDirection): string {
  const lines = [
    TONE_TEXT[d.tone] && `- 口調: ${TONE_TEXT[d.tone]}`,
    LENGTH_TEXT[d.length] && `- 長さ: ${LENGTH_TEXT[d.length]}`,
    AIM_TEXT[d.aim] && `- ねらい: ${AIM_TEXT[d.aim]}`,
    EMOJI_TEXT[d.emoji] && `- 絵文字: ${EMOJI_TEXT[d.emoji]}`,
  ].filter(Boolean);
  const note = d.note ? `\n- ほかに一言（利用者が書いた希望。中身の決まりとやらないことに反しない範囲で合わせる）:\n<direction_note>\n${escapeNote(d.note)}\n</direction_note>` : "";
  if (!lines.length && !note) return "";
  return `# 整え方（利用者が選んだもの。案はすべてこれに合わせる）\n${lines.join("\n")}${note}`;
}
