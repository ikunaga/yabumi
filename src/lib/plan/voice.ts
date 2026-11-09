import type { SupabaseClient } from "@supabase/supabase-js";
import { isSnsKey, SNS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import type { PlanData } from "./schema";
import type { AiUse } from "./story";
import { VOICE_EXAMPLE_CHARS, VOICE_MATERIAL_CHARS, VOICE_MATERIAL_POSTS } from "./voice-rules";

// 過去の自分の投稿から文調をそろえる（docs/design/voice-from-posts.md）。材料・例の投稿の読み込みと、AI に渡す形をここにまとめる
type Db = SupabaseClient<Database>;

export const VOICE_MEMO_FIELDS = ["length", "endings", "emoji", "phrases", "linebreaks", "hashtags", "other"] as const;
export type VoiceMemoField = (typeof VOICE_MEMO_FIELDS)[number];
export const VOICE_MEMO_LABEL: Record<VoiceMemoField, string> = {
  length: "文と投稿の長さ",
  endings: "語尾",
  emoji: "絵文字と記号",
  phrases: "よく使う言い回し",
  linebreaks: "改行",
  hashtags: "ハッシュタグ",
  other: "ほか",
};

// 自分で書いて送った投稿の本数（このプロジェクトの、送った配信先が 1 つでもある投稿のうち、本文を書いたのが AI でないもの。
// text_origin が null（列を足す前からある投稿）は、本人が書いたものとして数える）。利用者の権限で読む（RLS で本人のものだけ）
export async function countSelfWrittenPosts(db: Db, projectId: string): Promise<number> {
  const { count, error } = await db
    .from("posts")
    .select("id, post_targets!inner(id)", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("post_targets.status", "published")
    .or("text_origin.is.null,text_origin.eq.self");
  if (error) throw error;
  return count ?? 0;
}

// 書き方（文調のメモ）が書いてあるか（投稿をつくるで「書き方を読み取れます」を出すかに使う）
export async function hasVoiceMemo(db: Db, projectId: string): Promise<boolean> {
  const { data, error } = await db.from("account_plans").select("data").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  const memo = (data?.data as { voice?: { memo?: Record<string, unknown> } } | null)?.voice?.memo;
  return Boolean(memo && Object.values(memo).some((v) => typeof v === "string" && v.trim()));
}

// 材料の 1 本（送った配信先。本文は SNS ごとの文面があればそれ）
export type VoiceMaterial = { targetId: string; postId: string; sns: SnsKey; text: string; publishedAt: string };

type TargetRow = { id: string; sns: string; body_override: string | null; published_at: string | null; posts: { id: string; body: string; text_origin: string | null; project_id: string } | null };

const cut = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n).join("") + "…" : s);

// 材料: このプロジェクトの、送った、本人が書いた投稿（新しい順に 30 本、1 本 600 字まで。同じ本文（同じ投稿の SNS ごとの写し）は 1 本にまとめる）。
// 利用者の権限で読む（RLS で本人のものだけ）
export async function loadVoiceMaterial(db: Db, projectId: string, limit = VOICE_MATERIAL_POSTS): Promise<VoiceMaterial[]> {
  const { data, error } = await db
    .from("post_targets")
    .select("id, sns, body_override, published_at, posts!inner(id, body, text_origin, project_id)")
    .eq("status", "published")
    .eq("posts.project_id", projectId)
    .or("text_origin.is.null,text_origin.eq.self", { referencedTable: "posts" })
    .order("published_at", { ascending: false })
    .limit(limit * 4);
  if (error) throw error;
  const seen = new Set<string>();
  const out: VoiceMaterial[] = [];
  for (const r of (data ?? []) as unknown as TargetRow[]) {
    if (!r.posts || !isSnsKey(r.sns)) continue;
    const text = (r.body_override ?? r.posts.body).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ targetId: r.id, postId: r.posts.id, sns: r.sns, text: cut(text, VOICE_MATERIAL_CHARS), publishedAt: r.published_at ?? "" });
    if (out.length >= limit) break;
  }
  return out;
}

// 例の投稿として保存してよい id だけに絞る（このプロジェクトの、送った、本人が書いた投稿の配信先。3 本まで、並びはそのまま）
export async function allowedVoiceExamples(db: Db, projectId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const ok = new Set((await loadVoiceMaterial(db, projectId, 200)).map((m) => m.targetId));
  return [...new Set(ids)].filter((id) => ok.has(id)).slice(0, 3);
}

// 例の投稿の本文（AI に渡す。消した・送り終えていない・AI の文になった投稿は外れる）
export async function loadVoiceExamples(db: Db, projectId: string, ids: string[]): Promise<{ sns: SnsKey; text: string }[]> {
  if (ids.length === 0) return [];
  const material = await loadVoiceMaterial(db, projectId, 200);
  return ids.flatMap((id) => {
    const m = material.find((x) => x.targetId === id);
    return m ? [{ sns: m.sns, text: cut(m.text.replace(/…$/, ""), VOICE_EXAMPLE_CHARS) }] : [];
  });
}

// 一覧に出す投稿の頭（最初の空でない行の 60 字まで）
export function voiceHead(t: string): string {
  const line = t.split("\n").find((l) => l.trim()) ?? "";
  return [...line].length > 60 ? [...line].slice(0, 60).join("") + "…" : line;
}

// 書き方の欄に出す、例に選んだ投稿の頭（配信先の id ごと）。消した・送り終えていない・AI の文になった投稿は入らない
export async function loadVoiceExampleHeads(db: Db, projectId: string, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const material = await loadVoiceMaterial(db, projectId, 200);
  return Object.fromEntries(material.filter((m) => ids.includes(m.targetId)).map((m) => [m.targetId, voiceHead(m.text)]));
}

// AI に渡す書き方（文調のメモと例の投稿の本文）。どちらもなければ null（AI の材料に何も足さない）。例は利用者の権限で読む
export async function loadVoiceContext(db: Db, projectId: string, voice: PlanData["voice"]): Promise<VoiceContext | null> {
  const hasMemo = VOICE_MEMO_FIELDS.some((f) => voice.memo[f].trim());
  const examples = await loadVoiceExamples(db, projectId, voice.examples);
  return hasMemo || examples.length ? { voice, examples } : null;
}

// 書き方（文調のメモと例）を渡す AI（docs/design/voice-from-posts.md の 3.3）。絵の説明（image）と設計の相棒（coach）には渡さない
const VOICE_USES: readonly AiUse[] = ["ideas", "tidy", "check", "consult"];
export function voiceForUse(use: AiUse | "image_text"): boolean {
  return use === "image_text" || VOICE_USES.includes(use as AiUse);
}

export type VoiceContext = { voice: PlanData["voice"]; examples: { sns: SnsKey; text: string }[] };

// AI の材料に足す「# この人の書き方」（実装担当3 の日本語の決まりと見出しの名前をそろえた。書き方の細部はここに寄せ、中身の決まりはどの文調でも守る）。
// 文調のメモも例もなければ空
export function voicePromptLines(ctx: VoiceContext | null | undefined): string[] {
  if (!ctx) return [];
  const memo = VOICE_MEMO_FIELDS.flatMap((f) => (ctx.voice.memo[f].trim() ? [`- ${VOICE_MEMO_LABEL[f]}: ${ctx.voice.memo[f].trim()}`] : []));
  if (memo.length === 0 && ctx.examples.length === 0) return [];
  const lines = ["# この人の書き方（本人の投稿から読み取ったもの。語尾・絵文字・記号・改行・ハッシュタグの付け方などの書き方の細部は、これに寄せる。SNS ごとの口調があるときは、その SNS ではそちらを先にする）"];
  if (memo.length) lines.push("文調のメモ:", ...memo);
  if (ctx.examples.length) {
    lines.push("例の投稿（本人が書いたもの。言い回しや中身は写さず、書き方だけを寄せる）:");
    ctx.examples.forEach((e, i) => lines.push(`<example n="${i + 1}" sns="${SNS[e.sns].label}">\n${e.text.replace(/<(\/?)(example)\b/gi, "<$1$2_")}\n</example>`));
  }
  return lines;
}

// 例の投稿の本文（実装担当3 の言い回しの機械の確かめ styleProblems の allow に渡し、本人がふだん使う言い回しを指摘しない）
export function voiceExampleTexts(ctx: VoiceContext | null | undefined): string[] {
  return ctx?.examples.map((e) => e.text) ?? [];
}

// 数えた値（文調のメモをつくる AI に一緒に渡す。AI に数えさせない）
const EMOJI = /\p{Extended_Pictographic}/gu;
const HASHTAG = /(^|\s)[#＃][\p{L}\p{N}_]+/gu;
export function countVoiceStats(texts: string[]) {
  const n = Math.max(1, texts.length);
  const chars = texts.map((t) => [...t.replace(/\s/g, "")].length);
  const lines = texts.map((t) => t.split("\n").filter((l) => l.trim()).length);
  const emoji = texts.map((t) => (t.match(EMOJI) ?? []).length);
  const tags = texts.map((t) => (t.match(HASHTAG) ?? []).length);
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    avgChars: Math.round(chars.reduce((a, b) => a + b, 0) / n),
    minChars: texts.length ? Math.min(...chars) : 0,
    maxChars: texts.length ? Math.max(...chars) : 0,
    avgLines: round(lines.reduce((a, b) => a + b, 0) / n),
    avgEmoji: round(emoji.reduce((a, b) => a + b, 0) / n),
    withEmoji: emoji.filter((x) => x > 0).length,
    avgHashtags: round(tags.reduce((a, b) => a + b, 0) / n),
    withHashtags: tags.filter((x) => x > 0).length,
    withBlankLines: texts.filter((t) => /\n\s*\n/.test(t)).length,
  };
}
