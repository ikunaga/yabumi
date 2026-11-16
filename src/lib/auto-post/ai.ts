import "server-only";
import type { SnsKey } from "@/lib/sns";
import type { AutoKind, AutoRunReason } from "./types";

// 自動の投稿で AI に文を作らせる入口（docs/design/auto-post.md の 2.4）。
// 本物（Claude）は feat/auto-post-engine で作る。それまでと、画面の確かめ・テストでは、偽の AI（fakeGenerator）を使う。
//
// 偽の AI の差し込み口（画面の担当が、本物の AI を使わずに見本や回を確かめるため）:
// - 環境変数 AUTO_POST_FAKE_AI を入れると、autoPostGenerator() が偽の AI を返す（Vercel の上では、値があっても使わない）
//   - "1" か "ok": 材料から決まった文を返す（チェックに通る）
//   - "held": 「事実か確かめて」の指摘が付く文を返す（下書きに回る道を確かめる）
//   - "cannot": 「材料だけでは書けない」を返す（飛ばす道を確かめる）
// - テストは setAutoPostGeneratorForTest で好きな偽物を差し込む

export type GenerateInput = {
  kind: AutoKind;
  sns: SnsKey[];
  // その回の材料を AI に渡す形にしたもの（engine が組み立てる）。materialLabel は画面に出す短い名前（「メモ: 新しいパンの…」）
  material: string;
  materialLabel: string;
  // 設計・プロジェクトの紹介・口調などの前置き（engine が組み立てる）
  context: string;
  tone: string;
  // この回し方で直近に送った本文（重ならないように）
  recentBodies: string[];
  // SNS ごとの字数の上限
  maxLength: Partial<Record<SnsKey, number>>;
};

export type GenerateOutput =
  | { ok: true; texts: Partial<Record<SnsKey, string>>; issues?: { kind: AutoRunReason; detail: string }[] }
  | { ok: false; reason: "cannot_write"; detail: string };

export type AutoPostGenerator = (input: GenerateInput) => Promise<GenerateOutput>;

export type FakeMode = "ok" | "held" | "cannot";

// 偽の AI を使うか。Vercel の上（VERCEL_ENV がある）では使わない（本番・プレビューで偽の文が出ないように）
export function fakeAiMode(env: NodeJS.ProcessEnv = process.env): FakeMode | null {
  const v = env.AUTO_POST_FAKE_AI?.trim();
  if (!v || env.VERCEL_ENV) return null;
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
    return mode === "held" ? { ok: true, texts, issues: [{ kind: "made_up", detail: "（偽の AI）事実か確かめてほしいところがあります" }] } : { ok: true, texts };
  };
}

let testGenerator: AutoPostGenerator | null = null;

// テストだけで使う（差し込んだら、終わりに null で外す）
export function setAutoPostGeneratorForTest(g: AutoPostGenerator | null): void {
  testGenerator = g;
}

// いま使う AI。本物がまだないとき（engine の前）は null（画面は「準備中」と出す）
export function autoPostGenerator(): AutoPostGenerator | null {
  if (testGenerator) return testGenerator;
  const mode = fakeAiMode();
  if (mode) return fakeGenerator(mode);
  return null;
}
