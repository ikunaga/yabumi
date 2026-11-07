import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_PHOTO_TEMPLATES, MAX_PHOTO_TEMPLATES_PER_USER, templateInputSchema, type PhotoTemplate } from "./schema";

// 絵の説明のフォーマットの読み書き（利用者の権限のクライアントで。RLS で本人のものだけ。20261107120000_photo_prompt_templates）

type Db = SupabaseClient<Database>;

export class TemplateError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "TemplateError";
  }
}

const FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const NOT_FOUND = "フォーマットが見つかりません。画面を読み込み直してください。";

function check(input: unknown): { name: string; body: string } {
  const p = templateInputSchema.safeParse(input);
  if (!p.success) throw new TemplateError(p.error.issues[0]?.message ?? "入力の形式が正しくありません。");
  return p.data;
}

export async function listTemplates(db: Db, projectId: string): Promise<PhotoTemplate[]> {
  const { data, error } = await db.from("photo_prompt_templates").select("id, name, body, is_default").eq("project_id", projectId).order("position").order("created_at");
  if (error) throw error;
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, body: t.body, isDefault: t.is_default }));
}

// 1 つ読む（本人の、このプロジェクトのものだけ）。なければ null
export async function getTemplate(db: Db, projectId: string, id: string): Promise<PhotoTemplate | null> {
  const { data } = await db.from("photo_prompt_templates").select("id, name, body, is_default").eq("project_id", projectId).eq("id", id).maybeSingle();
  return data ? { id: data.id, name: data.name, body: data.body, isDefault: data.is_default } : null;
}

// 足す（並びはいちばん後ろ）。上限は DB が数える（同時に足しても超えない）
export async function addTemplate(db: Db, projectId: string, input: unknown): Promise<string> {
  const v = check(input);
  const { data: last } = await db.from("photo_prompt_templates").select("position").eq("project_id", projectId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db
    .from("photo_prompt_templates")
    .insert({ project_id: projectId, name: v.name, body: v.body, position: Math.min(100, (last?.position ?? -1) + 1) })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23514" && error.message.includes("1 人")) throw new TemplateError(`フォーマットは 1 人 ${MAX_PHOTO_TEMPLATES_PER_USER} 個までです（ほかのプロジェクトの分も数えます）。使わないものを消してから足してください。`);
    if (error.code === "23514" && error.message.includes("プロジェクト")) throw new TemplateError(`フォーマットは 1 つのプロジェクトに ${MAX_PHOTO_TEMPLATES} 個までです。使わないものを消してから足してください。`);
    if (error.code === "42501") throw new TemplateError(NOT_FOUND);
    throw new TemplateError(FAILED);
  }
  return data.id;
}

export async function updateTemplate(db: Db, projectId: string, id: string, input: unknown): Promise<void> {
  const v = check(input);
  const { data, error } = await db.from("photo_prompt_templates").update({ name: v.name, body: v.body }).eq("project_id", projectId).eq("id", id).select("id");
  if (error) throw new TemplateError(FAILED);
  if (!data?.length) throw new TemplateError(NOT_FOUND);
}

export async function deleteTemplate(db: Db, projectId: string, id: string): Promise<void> {
  const { data, error } = await db.from("photo_prompt_templates").delete().eq("project_id", projectId).eq("id", id).select("id");
  if (error) throw new TemplateError(FAILED);
  if (!data?.length) throw new TemplateError(NOT_FOUND);
}

// 「いつも使う」を付け替える（id が null なら外すだけ）。前を外してから付けるので、途中で失敗しても 2 つにはならない（0 個になるだけ。DB の部分ユニークでも縛る）
export async function setDefaultTemplate(db: Db, projectId: string, id: string | null): Promise<void> {
  const { error: e1 } = await db.from("photo_prompt_templates").update({ is_default: false }).eq("project_id", projectId).eq("is_default", true);
  if (e1) throw new TemplateError(FAILED);
  if (!id) return;
  const { data, error } = await db.from("photo_prompt_templates").update({ is_default: true }).eq("project_id", projectId).eq("id", id).select("id");
  // 23505: 同時にほかのフォーマットを「いつも使う」にした
  if (error) throw new TemplateError(error.code === "23505" ? "ほかの画面で「いつも使う」を変えました。読み込み直してください。" : FAILED);
  if (!data?.length) throw new TemplateError(NOT_FOUND);
}
