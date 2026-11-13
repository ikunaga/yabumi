"use server";

import { z } from "zod";
import { productTypeOf } from "@/lib/ai/product-guide";
import { createClient } from "@/lib/supabase/server";
import { FORMAT_EXAMPLES, FORMAT_KINDS, type PostFormat, type PostFormatInput } from "./schema";
import { FormatError, addFormat, deleteFormat, listFormats, updateFormat } from "./store";
import { addRound, deleteRound, discardRounds, listRounds, pasteRounds } from "./rounds";
import type { FormatRound } from "./series";

// 投稿をつくるの、投稿のフォーマットの操作（docs/architecture.md の 4.56）。利用者の権限で読み書きする（RLS で本人のものだけ）

// kinds: AI とつくるときの「何の投稿か」の決まった選択肢（宣伝するものの種類ごと）
export type FormatsResult = { formats?: PostFormat[]; examples?: PostFormatInput[]; kinds?: string[]; error?: string };

const BAD = { error: "入力の形式が正しくありません。" };

async function run(projectId: string, fn: (db: Awaited<ReturnType<typeof createClient>>) => Promise<void>): Promise<FormatsResult> {
  if (!z.uuid().safeParse(projectId).success) return BAD;
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return { error: "ログインし直してください。" };
  try {
    await fn(db);
    const { data: project } = await db.from("projects").select("product_type").eq("id", projectId).maybeSingle();
    if (!project) return { error: "プロジェクトが見つかりません。" };
    const type = productTypeOf(project.product_type);
    return { formats: await listFormats(db, projectId), examples: FORMAT_EXAMPLES[type], kinds: FORMAT_KINDS[type] };
  } catch (e) {
    if (e instanceof FormatError) return { error: e.userMessage };
    console.error("[post-formats]", e instanceof Error ? e.message : e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}

// 一覧と、種類ごとの例（どの操作も、終わったあとの一覧を返す）
export async function listPostFormats(projectId: string): Promise<FormatsResult> {
  return run(projectId, async () => {});
}

export async function addPostFormat(projectId: string, input: unknown): Promise<FormatsResult> {
  return run(projectId, async (db) => void (await addFormat(db, projectId, input)));
}

export async function updatePostFormat(projectId: string, id: string, input: unknown): Promise<FormatsResult> {
  if (!z.uuid().safeParse(id).success) return BAD;
  return run(projectId, (db) => updateFormat(db, projectId, id, input));
}

export async function deletePostFormat(projectId: string, id: string): Promise<FormatsResult> {
  if (!z.uuid().safeParse(id).success) return BAD;
  return run(projectId, (db) => deleteFormat(db, projectId, id));
}

// ===== シリーズの記録（docs/design/format-series.md の 2） =====
export type RoundsResult = { rounds?: FormatRound[]; id?: string | null; added?: number; skipped?: number; overflow?: number; error?: string };

async function runRounds(projectId: string, fn: (db: Awaited<ReturnType<typeof createClient>>) => Promise<RoundsResult>): Promise<RoundsResult> {
  if (!z.uuid().safeParse(projectId).success) return BAD;
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return { error: "ログインし直してください。" };
  try {
    return await fn(db);
  } catch (e) {
    if (e instanceof FormatError) return { error: e.userMessage };
    console.error("[post-format-rounds]", e instanceof Error ? e.message : e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}

const ids = z.array(z.uuid()).max(50);

export async function listFormatRounds(projectId: string, formatId: string): Promise<RoundsResult> {
  if (!z.uuid().safeParse(formatId).success) return BAD;
  return runRounds(projectId, async (db) => ({ rounds: await listRounds(db, formatId) }));
}

// 本文に入れたときの 1 回を記録する（AI の案を使った・自分で埋めた）。記録した id を返す（画面が、保存で投稿に結びつける・リセットで消す）
export async function addFormatRound(projectId: string, formatId: string, input: { answer: unknown; values: unknown; source: unknown }): Promise<RoundsResult> {
  if (!z.uuid().safeParse(formatId).success) return BAD;
  const source = input?.source === "ai" ? "ai" : "hand";
  return runRounds(projectId, async (db) => ({ id: await addRound(db, projectId, formatId, { answer: input?.answer, values: input?.values, source }) }));
}

export async function pasteFormatRounds(projectId: string, formatId: string, text: unknown): Promise<RoundsResult> {
  if (!z.uuid().safeParse(formatId).success || typeof text !== "string" || text.length > 20_000) return BAD;
  return runRounds(projectId, async (db) => ({ ...(await pasteRounds(db, projectId, formatId, text)), rounds: await listRounds(db, formatId) }));
}

export async function deleteFormatRound(projectId: string, formatId: string, id: string): Promise<RoundsResult> {
  if (!z.uuid().safeParse(formatId).success || !z.uuid().safeParse(id).success) return BAD;
  return runRounds(projectId, async (db) => {
    await deleteRound(db, id);
    return { rounds: await listRounds(db, formatId) };
  });
}

// リセット・保存した内容に戻すで本文から外したとき（まだ投稿に結びついていない記録だけ消す）
export async function discardFormatRounds(projectId: string, roundIds: unknown): Promise<RoundsResult> {
  const p = ids.safeParse(roundIds);
  if (!p.success) return BAD;
  return runRounds(projectId, async (db) => {
    await discardRounds(db, p.data);
    return {};
  });
}
