import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_POST_FORMATS, MAX_POST_FORMATS_PER_USER, formatInputSchema, readFormatHashtags, type PostFormat, type PostFormatInput } from "./schema";

// 投稿のフォーマットの読み書き（利用者の権限のクライアントで。RLS で本人のものだけ。20261110120000_post_formats）

type Db = SupabaseClient<Database>;

export class FormatError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "FormatError";
  }
}

const FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const NOT_FOUND = "フォーマットが見つかりません。画面を読み込み直してください。";
const COLUMNS = "id, name, purpose, body, example, pillar, hashtags";

type Row = Omit<PostFormat, "hashtags"> & { hashtags: unknown };
const toFormat = (r: Row): PostFormat => ({ ...r, hashtags: readFormatHashtags(r.hashtags) });

export function checkFormat(input: unknown): PostFormatInput {
  const p = formatInputSchema.safeParse(input);
  if (!p.success) throw new FormatError(p.error.issues[0]?.message ?? "入力の形式が正しくありません。");
  return p.data;
}

export async function listFormats(db: Db, projectId: string): Promise<PostFormat[]> {
  const { data, error } = await db.from("post_formats").select(COLUMNS).eq("project_id", projectId).order("position").order("created_at");
  if (error) throw error;
  return (data ?? []).map(toFormat);
}

// 1 つ読む（本人の、このプロジェクトのものだけ）。なければ null
export async function getFormat(db: Db, projectId: string, id: string): Promise<PostFormat | null> {
  const { data } = await db.from("post_formats").select(COLUMNS).eq("project_id", projectId).eq("id", id).maybeSingle();
  return data ? toFormat(data) : null;
}

// 足す（並びはいちばん後ろ）。上限は DB が数える（同時に足しても超えない）
export async function addFormat(db: Db, projectId: string, input: unknown): Promise<string> {
  const v = checkFormat(input);
  const { data: last } = await db.from("post_formats").select("position").eq("project_id", projectId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db
    .from("post_formats")
    .insert({ project_id: projectId, ...v, position: Math.min(100, (last?.position ?? -1) + 1) })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23514" && error.message.includes("1 人")) throw new FormatError(`フォーマットは 1 人 ${MAX_POST_FORMATS_PER_USER} 個までです（ほかのプロジェクトの分も数えます）。使わないものを削除してから足してください。`);
    if (error.code === "23514" && error.message.includes("プロジェクト")) throw new FormatError(`フォーマットは 1 つのプロジェクトに ${MAX_POST_FORMATS} 個までです。使わないものを削除してから足してください。`);
    if (error.code === "42501") throw new FormatError(NOT_FOUND);
    throw new FormatError(FAILED);
  }
  return data.id;
}

export async function updateFormat(db: Db, projectId: string, id: string, input: unknown): Promise<void> {
  const v = checkFormat(input);
  const { data, error } = await db.from("post_formats").update(v).eq("project_id", projectId).eq("id", id).select("id");
  if (error) throw new FormatError(FAILED);
  if (!data?.length) throw new FormatError(NOT_FOUND);
}

export async function deleteFormat(db: Db, projectId: string, id: string): Promise<void> {
  const { data, error } = await db.from("post_formats").delete().eq("project_id", projectId).eq("id", id).select("id");
  if (error) throw new FormatError(FAILED);
  if (!data?.length) throw new FormatError(NOT_FOUND);
}
