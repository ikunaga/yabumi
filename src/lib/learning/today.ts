import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GLOSSARY_KEYS, glossary, isGlossaryKey, type GlossaryKey } from "@/lib/glossary/terms";
import type { Database } from "@/lib/supabase/database.types";
import { pickTodayTerm, type LearningSignals } from "./today-term";

type Db = SupabaseClient<Database>;

export type TodayTerm = { key: GlossaryKey; label: string; summary: string };

// 説明の最初の 1 文（帯は 1 行なので）
export function firstSentence(text: string): string {
  const i = text.indexOf("。");
  return i >= 0 ? text.slice(0, i + 1) : text;
}

function toTodayTerm(key: GlossaryKey): TodayTerm {
  const t = glossary[key];
  return { key, label: t.label, summary: firstSentence(t.summary) };
}

const isKey = (k: string | null | undefined): k is GlossaryKey => typeof k === "string" && isGlossaryKey(k);

// 概要の「今日の用語」（4.47）。学びの表示がオフ・今日閉じた・用語集が空なら null。
// 語はアプリが選び（pickTodayTerm。用語集にある key だけ）、DB（learning_today_term）が日ごとに覚える。今日もう決めていれば、その語を返す
export async function loadTodayTerm(db: Db, signals: LearningSignals, today: string): Promise<TodayTerm | null> {
  const { data: prefs } = await db.from("notification_prefs").select("learning_enabled, learning_term_key, learning_term_on, learning_term_dismissed_on").maybeSingle();
  if (prefs && (!prefs.learning_enabled || prefs.learning_term_dismissed_on === today)) return null;
  if (prefs?.learning_term_on === today && isKey(prefs.learning_term_key)) return toTodayTerm(prefs.learning_term_key);

  const { data: reads, error } = await db.from("learning_term_reads").select("term_key, last_read_at");
  if (error) throw error;
  const pick = pickTodayTerm({ keys: GLOSSARY_KEYS, reads: (reads ?? []).map((r) => ({ key: r.term_key, lastReadAt: r.last_read_at })), signals });
  if (!pick) return null;
  const { data: stored, error: rpcError } = await db.rpc("learning_today_term", { p_term_key: pick });
  if (rpcError) throw rpcError;
  return isKey(stored) ? toTodayTerm(stored) : null;
}

// 読んだ用語の数（用語集の一覧の「読んだ語 n / 32」）と、読んだ key
export async function loadTermReads(db: Db): Promise<Set<GlossaryKey>> {
  const { data, error } = await db.from("learning_term_reads").select("term_key");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.term_key).filter(isKey));
}
