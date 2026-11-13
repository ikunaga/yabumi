import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { FormatError, getFormat } from "./store";
import { MAX_ROUNDS, answerKey, cleanAnswer, cleanRoundValues, isSeries, parsePastedAnswers, type FormatRound, type RoundSource } from "./series";

// シリーズの記録（post_format_rounds。docs/design/format-series.md の 2）の読み書き。利用者の権限のクライアントで（RLS で本人のものだけ）

type Db = SupabaseClient<Database>;

const FAILED = "記録できませんでした。時間をおいてもう一度お試しください。";

function toRound(r: { id: string; answer: string; values: unknown; source: string; post_id: string | null; created_at: string }): FormatRound {
  const values: Record<string, string> = {};
  if (r.values && typeof r.values === "object" && !Array.isArray(r.values)) {
    for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) if (typeof v === "string") values[k] = v;
  }
  return { id: r.id, answer: r.answer, values, source: r.source as RoundSource, postId: r.post_id, createdAt: r.created_at };
}

// 新しい順。limit を渡さなければ全件（300 回まで）
export async function listRounds(db: Db, formatId: string, limit = MAX_ROUNDS): Promise<FormatRound[]> {
  const { data, error } = await db
    .from("post_format_rounds")
    .select("id, answer, values, source, post_id, created_at")
    .eq("format_id", formatId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toRound);
}

const limitError = (message: string) =>
  message.includes("1 人")
    ? "シリーズの記録は 1 人 3,000 回までです。使わないフォーマットの記録を消してから足してください。"
    : `シリーズの記録は 1 つのフォーマットに ${MAX_ROUNDS} 回までです。古い回を消してから足してください。`;

// 本文に入れたときの 1 回（AI の案を使った・自分で埋めた）。シリーズのフォーマットだけ。答えも穴の言葉も空なら記録しない（null）
export async function addRound(db: Db, projectId: string, formatId: string, input: { answer: unknown; values: unknown; source: "ai" | "hand" }): Promise<string | null> {
  const format = await getFormat(db, projectId, formatId);
  if (!format) throw new FormatError("フォーマットが見つかりません。画面を読み込み直してください。");
  if (!isSeries(format.series)) return null;
  const answer = cleanAnswer(input.answer);
  const values = cleanRoundValues(format.body, input.values);
  if (!answer && Object.keys(values).length === 0) return null;
  const { data, error } = await db.from("post_format_rounds").insert({ format_id: formatId, answer, values, source: input.source }).select("id").single();
  if (error) {
    if (error.code === "23514") throw new FormatError(limitError(error.message));
    throw new FormatError(FAILED);
  }
  return data.id;
}

// 「これまでの回を貼る」（1 行に 1 つの答え。同じ答えは足さない。残りの回数と 100 行まで）
export async function pasteRounds(db: Db, projectId: string, formatId: string, text: string): Promise<{ added: number; skipped: number; overflow: number }> {
  const format = await getFormat(db, projectId, formatId);
  if (!format) throw new FormatError("フォーマットが見つかりません。画面を読み込み直してください。");
  if (!isSeries(format.series)) throw new FormatError("AI が埋める穴のあるフォーマットだけ、これまでの回を足せます。");
  const existing = await listRounds(db, formatId);
  const { answers, skipped, overflow } = parsePastedAnswers(text, existing.map((r) => r.answer), MAX_ROUNDS - existing.length);
  if (answers.length === 0) return { added: 0, skipped, overflow };
  const { error } = await db.from("post_format_rounds").insert(answers.map((answer) => ({ format_id: formatId, answer, values: {}, source: "pasted" as const })));
  if (error) {
    if (error.code === "23514") throw new FormatError(limitError(error.message));
    throw new FormatError(FAILED);
  }
  return { added: answers.length, skipped, overflow };
}

export async function deleteRound(db: Db, id: string): Promise<void> {
  const { error } = await db.from("post_format_rounds").delete().eq("id", id);
  if (error) throw new FormatError(FAILED);
}

// リセット・保存した内容に戻すで本文から外したとき: その画面で付けた記録のうち、まだ投稿に結びついていないものを消す（設計の 2。Q1）
export async function discardRounds(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db.from("post_format_rounds").delete().in("id", ids).is("post_id", null);
  if (error) throw new FormatError(FAILED);
}

// 投稿を保存したら、その画面で付けた記録をその投稿に結びつける（まだ結びついていないものだけ。RLS で結びつける先も自分の投稿だけ）
export async function attachRounds(db: Db, ids: string[], postId: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db.from("post_format_rounds").update({ post_id: postId }).in("id", ids).is("post_id", null);
  if (error) throw error;
}

// 答えがもう記録にあるか（重なりを捨てるとき）
export function usedAnswerKeys(rounds: Pick<FormatRound, "answer">[]): Set<string> {
  return new Set(rounds.map((r) => answerKey(r.answer)).filter(Boolean));
}
