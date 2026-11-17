import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callAutoPost } from "@/lib/ai/anthropic";
import { withAiBudget } from "@/lib/ai/budget";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { autoPostDraftSchema } from "./ai-schema";
import { buildAutoPostRequest } from "./prompt";
import type { AutoKind, AutoRunReason } from "./types";

// 自動の投稿で AI に文を作らせる入口（docs/design/auto-post.md の 2.4）。
// 本物は Claude（callAutoPost。用途 auto_post で自動の投稿の枠に数える）。画面の確かめ・テストでは偽の AI（fakeGenerator）を使う。
//
// 偽の AI の差し込み口（画面の担当が、本物の AI を使わずに見本や回を確かめるため）:
// - 環境変数 AUTO_POST_FAKE_AI を入れると、autoPostGenerator() が偽の AI を返す（Vercel の上では、値があっても使わない）
//   - "1" か "ok": 材料から決まった文を返す（チェックに通る）
//   - "held": 「事実か確かめて」の指摘が付く文を返す（下書きに回る道を確かめる）
//   - "cannot": 「材料だけでは書けない」を返す（飛ばす道を確かめる）
// - テストは setAutoPostGeneratorForTest で好きな偽物を差し込む

type Db = SupabaseClient<Database>;

export type GenerateInput = {
  ownerId: string;
  kind: AutoKind;
  sns: SnsKey[];
  // その回の材料を AI に渡す形にしたもの（materials.ts が組み立てる）。materialLabel は画面に出す短い名前（「メモ: 新しいパンの…」）
  material: string;
  materialLabel: string;
  // 設計・プロジェクトの紹介・SNS ごとの書き方（ideaContextText）
  context: string;
  tone: string;
  // この回し方で直近に送った本文（重ならないように）
  recentBodies: string[];
  // SNS ごとの字数の上限（本文とは別に付くタグの行の分を引いたもの）
  maxLength: Partial<Record<SnsKey, number>>;
  // 本文とは別に付くタグ（シリーズのフォーマット・いつものタグ）。AI は本文にハッシュタグを書かない
  fixedTags?: Partial<Record<SnsKey, string[]>>;
};

export type GenerateOutput =
  | { ok: true; texts: Partial<Record<SnsKey, string>>; pillar?: string; concern?: string; issues?: { kind: AutoRunReason; detail: string }[] }
  | { ok: false; reason: "cannot_write" | "ai_limit" | "error"; detail: string };

export type AutoPostGenerator = (input: GenerateInput) => Promise<GenerateOutput>;

export type FakeMode = "ok" | "held" | "cannot";

// 偽の AI を使うか。Vercel の上（VERCEL_ENV がある）では使わない（本番・プレビューで偽の文が出ないように）
export function fakeAiMode(env: NodeJS.ProcessEnv = process.env): FakeMode | null {
  const v = env.AUTO_POST_FAKE_AI?.trim();
  // 本番（Vercel・next start の本番ビルド）では、変数が残っていても偽の AI にしない
  if (!v || env.VERCEL_ENV || env.NODE_ENV === "production") return null;
  if (v === "held" || v === "cannot") return v;
  return "ok";
}

export function fakeGenerator(mode: FakeMode = "ok"): AutoPostGenerator {
  return async (input) => {
    if (mode === "cannot") return { ok: false, reason: "cannot_write", detail: "（偽の AI）材料だけでは書けませんでした" };
    const texts: Partial<Record<SnsKey, string>> = {};
    for (const sns of input.sns) {
      const max = input.maxLength[sns] ?? 500;
      texts[sns] = `（偽の AI）${input.materialLabel}をもとにした ${sns} の投稿です。`.slice(0, max);
    }
    return mode === "held" ? { ok: true, texts, issues: [{ kind: "made_up", detail: "（偽の AI）事実か確かめてほしいところがあります" }] } : { ok: true, texts, pillar: "", concern: "none" };
  };
}

// 本物の AI（Claude）。予約（reserve_ai_usage の auto_post）→ 呼ぶ → 実際の額に直す
export function realGenerator(admin: Db, call = callAutoPost): AutoPostGenerator {
  return async (input) => {
    const request = buildAutoPostRequest({ context: input.context, material: input.material, tone: input.tone, recentBodies: input.recentBodies, fixedTags: input.fixedTags });
    try {
      const b = await withAiBudget(admin, { userId: input.ownerId, purpose: "auto_post", call: "auto_post" }, request, call);
      if (!b.ok) return { ok: false, reason: "ai_limit", detail: b.message };
      const r = b.result;
      if (r.stopReason === "refusal") return { ok: false, reason: "cannot_write", detail: "AI がこの材料では書けませんでした" };
      const parsed = r.stopReason === "end_turn" ? autoPostDraftSchema.safeParse(r.output) : null;
      if (!parsed?.success) return { ok: false, reason: "error", detail: "AI の返事を読めませんでした" };
      const d = parsed.data;
      if (d.cannot_write?.trim() || d.texts.length === 0) return { ok: false, reason: "cannot_write", detail: (d.cannot_write ?? "").trim().slice(0, 200) || "材料だけでは書けませんでした" };
      const texts: Partial<Record<SnsKey, string>> = {};
      for (const t of d.texts) if (isSnsKey(t.sns) && input.sns.includes(t.sns) && t.text.trim()) texts[t.sns] = t.text.trim();
      if (!input.sns.every((s) => texts[s])) return { ok: false, reason: "error", detail: "SNS ごとの文がそろいませんでした" };
      return { ok: true, texts, pillar: d.pillar.trim().slice(0, 50), concern: d.concern };
    } catch (e) {
      console.error("[auto-post] AI の呼び出しに失敗しました", e instanceof Error ? e.message : e);
      return { ok: false, reason: "error", detail: "AI とのやりとりがうまくいきませんでした" };
    }
  };
}

let testGenerator: AutoPostGenerator | null = null;

// テストだけで使う（差し込んだら、終わりに null で外す）
export function setAutoPostGeneratorForTest(g: AutoPostGenerator | null): void {
  testGenerator = g;
}

// いま使う AI。テストの差し込み → 偽の AI（AUTO_POST_FAKE_AI）→ 本物（Claude のキーがあるとき）の順。どれもなければ null（画面は「準備中」と出す）
export function autoPostGenerator(admin: Db, env: NodeJS.ProcessEnv = process.env): AutoPostGenerator | null {
  if (testGenerator) return testGenerator;
  const mode = fakeAiMode(env);
  if (mode) return fakeGenerator(mode);
  return env.ANTHROPIC_API_KEY ? realGenerator(admin) : null;
}
