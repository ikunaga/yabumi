import { z } from "zod";
import { formatSlots, MAX_SLOT_NAME, MAX_SLOT_VALUE } from "./schema";

// フォーマットの変数（docs/design/format-series.md の 1。2026-11-21 オーナーの決定）。画面とサーバーの両方から読む。
// 変数は投稿ごとに変わる言葉。本文・画像の設定（絵の説明・見出し・小さい文）に {名前} と書くと、そこに入る。
// 作り方は「毎回 AI が考える（ai）」か「投稿をつくるときに自分で入れる（hand）」。どこにも書かない変数は投稿に出ず、重ならない目印などに使う。
// 字数と数の正は DB（20261121180000_format_variables の format_series_valid とトリガー）。ここはその写しと、決まりの関数

// 変数は 12 個まで、そのうち AI が考えるのは 8 個まで。AI への指示は 60 字まで（DB の format_series_valid と同じ値）
export const MAX_FORMAT_VARS = 12;
export const MAX_AI_VARS = 8;
export const MAX_SERIES_INSTRUCTION = 60;
// 記録は 1 つのフォーマットに 300 回まで（DB のトリガーで同じ値）
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

export type VarMode = "ai" | "hand";
// unique: 前の投稿と重ならないようにする（連想映画クイズの「映画」）
export type FormatVar = { name: string; mode: VarMode; instruction: string; unique: boolean };
export type FormatSeries = { vars: FormatVar[] };
export const EMPTY_SERIES: FormatSeries = { vars: [] };

export type RoundSource = "ai" | "pasted" | "hand";
// values: 変数の名前 → その回の言葉（どこにも出ない変数も含む）
export type FormatRound = { id: string; values: Record<string, string>; source: RoundSource; postId: string | null; createdAt: string };

const oneLine = (s: unknown, max: number) => (typeof s === "string" ? [...s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim()].slice(0, max).join("") : "");

// 変数の名前に使えるか（12 字まで・「{」「}」と改行なし）
export const okVarName = (name: string) => !!name && [...name].length <= MAX_SLOT_NAME && !/[{}\n\r]/.test(name);

// 変数を書ける文（本文と画像の設定）。どこに書いてあるかの札と、書いてあるのに一覧にない名前を見るのに使う
export type VarTexts = { body: string; image?: { prompt: string; headline: string | null; label: string | null } | null };
const imageTexts = (t: VarTexts) => (t.image ? [t.image.prompt, t.image.headline ?? "", t.image.label ?? ""].join("\n") : "");

// 本文・画像の設定に書いてある変数の名前（本文 → 画像の順、同じ名前は 1 つ）
export const namesInTexts = (t: VarTexts) => [...new Set([...formatSlots(t.body), ...formatSlots(imageTexts(t))])];

// 変数が入る場所（本文・画像）。どちらもなければ投稿には出ない
export type VarPlace = "body" | "image";
export function varPlaces(name: string, t: VarTexts): VarPlace[] {
  const out: VarPlace[] = [];
  if (formatSlots(t.body).includes(name)) out.push("body");
  if (formatSlots(imageTexts(t)).includes(name)) out.push("image");
  return out;
}

// 前の形（answer = 本文に出さない答え、slots = AI が埋める空欄）。DB はマイグレーションで移したが、古い画面から来た値も読めるようにしておく
function fromLegacy(r: { answer?: unknown; slots?: unknown }): unknown[] {
  const out: unknown[] = [];
  if (r.answer && typeof r.answer === "object" && !Array.isArray(r.answer)) {
    const a = r.answer as { name?: unknown; instruction?: unknown };
    out.push({ name: oneLine(a.name, MAX_SLOT_NAME) || "答え", mode: "ai", instruction: a.instruction, unique: true });
  }
  if (r.slots && typeof r.slots === "object" && !Array.isArray(r.slots)) {
    for (const [name, instruction] of Object.entries(r.slots as Record<string, unknown>)) out.push({ name, mode: "ai", instruction, unique: false });
  }
  return out;
}

// DB から読んだ値・画面から来た値を、決まった形にそろえる。名前の合わないもの・同じ名前は捨て、12 個・AI 8 個までにする。
// texts を渡すと、本文・画像の設定に書いてあるのに一覧にない名前を「自分で入れる」変数として足す（{名前} と書いただけで変数になる）
export function cleanSeries(raw: unknown, texts?: VarTexts): FormatSeries {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { vars?: unknown; answer?: unknown; slots?: unknown }) : {};
  const items = Array.isArray(r.vars) ? r.vars : fromLegacy(r);
  const vars: FormatVar[] = [];
  for (const x of items) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const v = x as Record<string, unknown>;
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!okVarName(name) || vars.some((o) => o.name === name)) continue;
    if (vars.length >= MAX_FORMAT_VARS) break;
    let mode: VarMode = v.mode === "ai" ? "ai" : "hand";
    if (mode === "ai" && vars.filter((o) => o.mode === "ai").length >= MAX_AI_VARS) mode = "hand";
    vars.push({ name, mode, instruction: mode === "ai" ? oneLine(v.instruction, MAX_SERIES_INSTRUCTION) : "", unique: v.unique === true });
  }
  if (texts) {
    // 「自分で入れる」変数は、本文・画像の設定のどこにも書いていなければ使い道がないので持たない
    const placed = new Set(namesInTexts(texts));
    for (let i = vars.length - 1; i >= 0; i--) if (vars[i].mode === "hand" && !placed.has(vars[i].name)) vars.splice(i, 1);
    for (const name of namesInTexts(texts)) {
      if (vars.length >= MAX_FORMAT_VARS) break;
      if (okVarName(name) && !vars.some((o) => o.name === name)) vars.push({ name, mode: "hand", instruction: "", unique: false });
    }
  }
  return { vars };
}

export const aiVars = (s: FormatSeries | null | undefined) => (s?.vars ?? []).filter((v) => v.mode === "ai");
export const handVars = (s: FormatSeries | null | undefined) => (s?.vars ?? []).filter((v) => v.mode === "hand");
export const varNames = (s: FormatSeries | null | undefined) => (s?.vars ?? []).map((v) => v.name);

// AI が考える変数が 1 つでもあれば、シリーズ（次の回の案・自動投稿・これまでの回）
export const isSeries = (s: FormatSeries | null | undefined) => aiVars(s).length > 0;

// 指示の中で使っているほかの変数（{名前}）
export const varRefs = (instruction: string) => formatSlots(instruction);

// AI が決める順（指示の中で使われている変数を先に）。ぐるぐる回る使い方があれば cycle にその名前を入れる
export function aiVarOrder(s: FormatSeries | null | undefined): { order: string[]; cycle: string[] } {
  const ai = aiVars(s);
  const names = new Set(ai.map((v) => v.name));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const cycle: string[] = [];
  const visit = (name: string, path: string[]) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") {
      for (const n of path.slice(path.indexOf(name))) if (!cycle.includes(n)) cycle.push(n);
      return;
    }
    state.set(name, "visiting");
    for (const ref of varRefs(ai.find((v) => v.name === name)?.instruction ?? "")) if (names.has(ref) && ref !== name) visit(ref, [...path, ref]);
    state.set(name, "done");
    order.push(name);
  };
  for (const v of ai) visit(v.name, [v.name]);
  return { order, cycle };
}

// 保存できない設定（合っていれば null）。指示の中の {名前} は、一覧にあるほかの変数だけ。ぐるぐる回る使い方は断る
export function seriesProblem(s: FormatSeries): string | null {
  for (const v of aiVars(s)) {
    const refs = varRefs(v.instruction);
    if (refs.includes(v.name)) return `{${v.name}} の指示の中で、{${v.name}} 自身は使えません。`;
    const missing = refs.find((n) => !s.vars.some((o) => o.name === n));
    if (missing) return `{${v.name}} の指示にある {${missing}} は、変数の一覧にありません。`;
  }
  const { cycle } = aiVarOrder(s);
  if (cycle.length) return `${cycle.map((n) => `{${n}}`).join("と")}の指示に、おたがいの名前が入っています。どちらかの指示から削除してください。`;
  return null;
}

// 本文が毎回同じシリーズ（本文に AI の変数がない。画像や、どこにも出ない変数だけが変わる）。
// 自動投稿で X を選べない（X は同じ文の投稿を続けて送れない）・前の投稿と似ているかを本文で見ない（format-series.md の 1.1）
export function fixedBodySeries(body: string, series: FormatSeries | null | undefined): boolean {
  const inBody = formatSlots(body);
  return isSeries(series) && !aiVars(series).some((v) => inBody.includes(v.name));
}
export const X_FIXED_BODY = "選んだフォーマットは、本文が毎回同じです。X は同じ文を続けて送れないため、選べません。";

// 編集の欄から（保存のときに cleanSeries でそろえる）
export const seriesInput = z.unknown().optional();

// 重なりを見るための形（全角・半角、大文字・小文字、空白・中黒・記号の違いをそろえる）
export function answerKey(answer: string): string {
  return answer
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･·、。,.!?！？「」『』"'“”‘’\-ー―~〜:：]/gu, "");
}

// 回の言葉をそろえる（一覧にある変数だけ・1 行・200 字まで・空は捨てる）
export function cleanRoundValues(series: FormatSeries | null | undefined, raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const name of varNames(series)) {
    const v = oneLine((raw as Record<string, unknown>)[name], MAX_SLOT_VALUE);
    if (v) out[name] = v;
  }
  return out;
}

// DB から読んだ記録の言葉（jsonb）を、文字の値だけの形にする
export function readRoundValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
}

// 重なりを見る目印。「重ならないようにする」変数ごとに、その言葉。どれにも付いていなければ、AI の変数の言葉の組み合わせ
export function roundKeys(series: FormatSeries | null | undefined, values: Record<string, string>): string[] {
  const unique = (series?.vars ?? []).filter((v) => v.unique);
  if (unique.length) return unique.flatMap((v) => {
    const k = answerKey(values[v.name] ?? "");
    return k ? [`${v.name}:${k}`] : [];
  });
  const k = answerKey(aiVars(series).map((v) => values[v.name] ?? "").join("|"));
  return k ? [`*:${k}`] : [];
}

// もう出した回の目印（記録の全件）
export function usedRoundKeys(series: FormatSeries | null | undefined, rounds: Pick<FormatRound, "values">[]): Set<string> {
  return new Set(rounds.flatMap((r) => roundKeys(series, r.values)));
}

// 「これまでの回を貼る」で 1 行を入れる変数（「重ならないようにする」の最初の変数。なければ最初の AI の変数）
export function pasteVar(series: FormatSeries | null | undefined): FormatVar | null {
  return (series?.vars ?? []).find((v) => v.unique) ?? aiVars(series)[0] ?? null;
}

// 案や記録を見分ける 1 行の見出し（「重ならないようにする」変数の言葉。なければ AI の変数の言葉）
export function roundTitle(series: FormatSeries | null | undefined, values: Record<string, string>): string {
  const unique = (series?.vars ?? []).filter((v) => v.unique && values[v.name]);
  const pick = unique.length ? unique : aiVars(series).filter((v) => values[v.name]);
  return pick.map((v) => values[v.name]).join("・");
}

// 1 行に 1 つの言葉。空行・同じ言葉（記録にあるもの・貼った中での重なり）は捨て、room（残りの回数）と 100 行までにする
export function parsePastedAnswers(text: string, used: string[], room: number): { answers: string[]; skipped: number; overflow: number } {
  const seen = new Set(used.map(answerKey));
  const answers: string[] = [];
  let skipped = 0;
  let overflow = 0;
  const limit = Math.max(0, Math.min(room, MAX_PASTE_ROUNDS));
  for (const line of text.split(/\r?\n/)) {
    const a = oneLine(line.replace(/^\s*(?:[-・*•]|\d+[.)．）])\s*/u, ""), MAX_SLOT_VALUE);
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

// AI に「もう出した回」として渡す 1 行（変数の言葉。300 字までに切る）
export function roundLine(r: Pick<FormatRound, "values">): string {
  const vals = Object.entries(r.values)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" / ");
  return [...vals].slice(0, ROUND_TEXT_FOR_AI).join("");
}

// ===== 自動投稿の「自分で入れる」変数の決め方（auto_plans.materials.format_vars。2026-11-21 オーナーの決定） =====
// value: 毎回同じ言葉を入れる / instruction: 自動投稿では AI に考えてもらう
export type PlanVarChoice = { value: string } | { instruction: string };
export type PlanVars = Record<string, PlanVarChoice>;
export const MAX_PLAN_VAR_VALUE = MAX_SLOT_VALUE;

export function readPlanVars(raw: unknown): PlanVars {
  const out: PlanVars = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const c = v as Record<string, unknown>;
    if (typeof c.value === "string") {
      const value = oneLine(c.value, MAX_PLAN_VAR_VALUE);
      if (value) out[k] = { value };
    } else if (typeof c.instruction === "string") {
      const instruction = oneLine(c.instruction, MAX_SERIES_INSTRUCTION);
      if (instruction) out[k] = { instruction };
    }
  }
  return out;
}

// 決めていない「自分で入れる」変数（あれば保存できない）
export const undecidedPlanVars = (series: FormatSeries | null | undefined, choices: PlanVars) => handVars(series).filter((v) => !choices[v.name]).map((v) => v.name);

// 自動投稿で使う変数の一覧（「AI に考えてもらう」を選んだ自分で入れる変数を AI の変数にし、「毎回同じ言葉」はその言葉で決まった値にする）
export function seriesForPlan(series: FormatSeries, choices: PlanVars): { series: FormatSeries; fixed: Record<string, string> } {
  const fixed: Record<string, string> = {};
  const vars: FormatVar[] = [];
  for (const v of series.vars) {
    const c = v.mode === "hand" ? choices[v.name] : undefined;
    if (c && "instruction" in c) vars.push({ ...v, mode: "ai", instruction: c.instruction });
    else {
      if (c && "value" in c) fixed[v.name] = c.value;
      vars.push(v);
    }
  }
  return { series: { vars }, fixed };
}

// 保存したときの変数の作り方（名前 → ai / hand）。いまのフォーマットと違えば、自動投稿は止めて知らせる（format_changed）
export const varModes = (series: FormatSeries | null | undefined): Record<string, VarMode> => Object.fromEntries((series?.vars ?? []).map((v) => [v.name, v.mode]));
export function varModesChanged(saved: unknown, series: FormatSeries | null | undefined): boolean {
  const now = varModes(series);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return true;
  const s = saved as Record<string, unknown>;
  const keys = Object.keys(now);
  return keys.length !== Object.keys(s).length || keys.some((k) => s[k] !== now[k]);
}
