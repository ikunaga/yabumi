"use server";

import { z } from "zod";
import { productTypeOf } from "@/lib/ai/product-guide";
import { createClient } from "@/lib/supabase/server";
import { TEMPLATE_EXAMPLES, type PhotoTemplate } from "./schema";
import { TemplateError, addTemplate, deleteTemplate, listTemplates, setDefaultTemplate, updateTemplate } from "./store";

// 画像をつくる画面の、絵の説明のフォーマットの操作（docs/architecture.md の 4.25 の ②）。利用者の権限で読み書きする（RLS で本人のものだけ）

export type TemplatesResult = { templates?: PhotoTemplate[]; examples?: { name: string; body: string }[]; error?: string };

const BAD = { error: "入力の形式が正しくありません。" };

async function run(projectId: string, fn: (db: Awaited<ReturnType<typeof createClient>>) => Promise<void>): Promise<TemplatesResult> {
  if (!z.uuid().safeParse(projectId).success) return BAD;
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return { error: "ログインし直してください。" };
  try {
    await fn(db);
    const { data: project } = await db.from("projects").select("product_type").eq("id", projectId).maybeSingle();
    if (!project) return { error: "プロジェクトが見つかりません。" };
    return { templates: await listTemplates(db, projectId), examples: TEMPLATE_EXAMPLES[productTypeOf(project.product_type)] };
  } catch (e) {
    if (e instanceof TemplateError) return { error: e.userMessage };
    console.error("[photo-templates]", e instanceof Error ? e.message : e);
    return { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
  }
}

// 一覧と、種類ごとの例（どの操作も、終わったあとの一覧を返す）
export async function listPhotoTemplates(projectId: string): Promise<TemplatesResult> {
  return run(projectId, async () => {});
}

export async function addPhotoTemplate(projectId: string, input: unknown): Promise<TemplatesResult> {
  return run(projectId, async (db) => void (await addTemplate(db, projectId, input)));
}

export async function updatePhotoTemplate(projectId: string, id: string, input: unknown): Promise<TemplatesResult> {
  if (!z.uuid().safeParse(id).success) return BAD;
  return run(projectId, (db) => updateTemplate(db, projectId, id, input));
}

export async function deletePhotoTemplate(projectId: string, id: string): Promise<TemplatesResult> {
  if (!z.uuid().safeParse(id).success) return BAD;
  return run(projectId, (db) => deleteTemplate(db, projectId, id));
}

export async function setDefaultPhotoTemplate(projectId: string, id: string | null): Promise<TemplatesResult> {
  if (id !== null && !z.uuid().safeParse(id).success) return BAD;
  return run(projectId, (db) => setDefaultTemplate(db, projectId, id));
}
