import { z } from "zod";
import { formatSlots, MAX_SLOT_VALUE } from "./schema";

// シリーズ投稿（フォーマットの一部を AI が毎回埋める。docs/design/format-series.md）。画面とサーバーの両方から読む。
// 字数と数の正は DB（20261113140000_format_series の check とトリガー）。ここはその写しと、決まりの関数

// AI への指示は 60 字まで、答えの名前は 12 字まで（穴の名前と同じ）
export const MAX_SERIES_INSTRUCTION = 60;
export const MAX_ANSWER_NAME = 12;
// 答えの名前を空にしたときの名前・答えの決まりがないときに案やこれまでの回で答えに添える名前
export const DEFAULT_ANSWER_NAME = "答え";
// 記録の答えは 100 字まで、1 つのフォーマットに 300 回まで（DB のトリガーで同じ値）
export const MAX_ROUND_ANSWER = 100;
export const MAX_ROUNDS = 300;
// 「これまでの回を貼る」は 1 回に 100 行まで（残りが少なければ残りまで）
export const MAX_PASTE_ROUNDS = 100;
// AI に「もう出した回」として渡すのは直近 100 回（1 回 300 字までに切る）。重なりを捨てるのは記録の全件で見る
export const ROUNDS_FOR_AI = 100;
export const ROUND_TEXT_FOR_AI = 300;
// 次の回の案の数と、利用者の希望の長さ
export const ROUND_PROPOSALS = 3;
export const MAX_ROUND_WISH = 100;
// 次の回の案は 1 人 1 日 20 回まで（DB の reserve_ai_usage の c_post_format_round_daily_runs と同じ値）
export const SERIES_DAILY_RUNS = 20;

export type FormatSeries = { answer: { name: string; instruction: string } | null; slots: Record<string, string> };
export const EMPTY_SERIES: FormatSeries = { answer: null, slots: {} };

export type RoundSource = "ai" | "pasted" | "hand";
export type FormatRound = { id: string; answer: string; values: Record<string, string>; source: RoundSource; postId: string | null; createdAt: string };

const oneLine = (s: unknown, max: number) => (typeof s === "string" ? [...s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].slice(0, max).join("") : "");

// DB から読んだ値・画面から来た値を、決まった形にそろえる。body を渡すと、型の文にない穴の指示を捨てる（AI の穴は 8 つまで）
export function cleanSeries(raw: unknown, body?: string): FormatSeries {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_SERIES, slots: {} };
  const r = raw as { answer?: unknown; slots?: unknown };
  const slotNames = body === undefined ? null : formatSlots(body);
  const slots: Record<string, string> = {};
  if (r.slots && typeof r.slots === "object" && !Array.isArray(r.slots)) {
    for (const [k, v] of Object.entries(r.slots as Record<string, unknown>)) {
      const name = k.trim();
      if (!name || [...name].length > 12 || (slotNames && !slotNames.includes(name))) continue;
      if (Object.keys(slots).length >= 8) break;
      slots[name] = oneLine(v, MAX_SERIES_INSTRUCTION);
    }
  }
  let answer: FormatSeries["answer"] = null;
  if (r.answer && typeof r.answer === "object" && !Array.isArray(r.answer)) {
    const a = r.answer as { name?: unknown; instruction?: unknown };
    // 「答えを持つ」を選んで名前を空のまま保存したときは「答え」にする（前は黙って答えなしになり、案に答えが出なかった。PMO2 の 3 回目の n1）
    const name = oneLine(a.name, MAX_ANSWER_NAME) || DEFAULT_ANSWER_NAME;
    answer = { name, instruction: oneLine(a.instruction, MAX_SERIES_INSTRUCTION) };
  }
  return { answer, slots };
}

// AI の穴が 1 つでもあれば、シリーズのフォーマット
export const isSeries = (s: FormatSeries | null | undefined) => Object.keys(s?.slots ?? {}).length > 0;

// 編集の欄から（保存のときに型の文で穴をそろえる）
export const seriesInput = z.unknown().optional();

// 答えの重なりを見るための形（全角・半角、大文字・小文字、空白・中黒・記号の違いをそろえる）
export function answerKey(answer: string): string {
  return answer
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･·、。,.!?！？「」『』"'“”‘’\-ー―~〜:：]/gu, "");
}

// 穴の言葉をそろえる（型の文にある穴だけ・1 行・200 字まで・空は捨てる）
export function cleanRoundValues(body: string, raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const name of formatSlots(body)) {
    const v = oneLine((raw as Record<string, unknown>)[name], MAX_SLOT_VALUE);
    if (v) out[name] = v;
  }
  return out;
}

export const cleanAnswer = (s: unknown) => oneLine(s, MAX_ROUND_ANSWER);

// 「これまでの回を貼る」: 1 行に 1 つの答え。空行・同じ答え（記録にあるもの・貼った中での重なり）は捨て、room（残りの回数）と 100 行までにする
export function parsePastedAnswers(text: string, used: string[], room: number): { answers: string[]; skipped: number; overflow: number } {
  const seen = new Set(used.map(answerKey));
  const answers: string[] = [];
  let skipped = 0;
  let overflow = 0;
  const limit = Math.max(0, Math.min(room, MAX_PASTE_ROUNDS));
  for (const line of text.split(/\r?\n/)) {
    const a = cleanAnswer(line.replace(/^\s*(?:[-・*•]|\d+[.)．）])\s*/u, ""));
    if (!a) continue;
    const key = answerKey(a);
    if (!key || seen.has(key)) {
      skipped++;
      continue;
    }
    if (answers.length >= limit) {
      overflow++;
      continue;
    }
    seen.add(key);
    answers.push(a);
  }
  return { answers, skipped, overflow };
}

// AI に「もう出した回」として渡す 1 行（答えと穴の言葉。300 字までに切る）
export function roundLine(r: Pick<FormatRound, "answer" | "values">): string {
  const vals = Object.entries(r.values)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" / ");
  return [...[r.answer, vals].filter(Boolean).join(" ｜ ")].slice(0, ROUND_TEXT_FOR_AI).join("");
}
