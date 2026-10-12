"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { connectedAccounts } from "@/lib/posts/queries";
import type { SnsKey } from "@/lib/sns";
import { canPublish } from "@/lib/sns/adapters";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MAX_NOTE_CHARS } from "./rules";
import { SHARE_COOKIE } from "./share";
import { createNote, deleteNote, noteToDraft, updateNote } from "./store";

// ネタ帳の操作（docs/architecture.md の 4.26）。画像は 4.18 の流れ（requestImageUpload → 上げる → confirmImageUpload）で上げてから、id を渡す

async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

export type NoteActionResult = { error?: string };

const BAD_INPUT = { error: "入力の形式が正しくありません。画面を読み込み直してください。" };
const FAILED = { error: "うまくいきませんでした。時間をおいてもう一度お試しください。" };
const bodySchema = z.string().max(MAX_NOTE_CHARS * 2);
const uuid = z.uuid();

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/notes`);
  revalidatePath(`/projects/${projectId}/ideas`);
}

// メモを残す（「＋ メモ」と、ほかのアプリからの共有）
export async function saveNote(projectId: string, body: unknown, mediaId: unknown): Promise<NoteActionResult> {
  const b = bodySchema.safeParse(body);
  const m = uuid.nullable().safeParse(mediaId);
  if (!uuid.safeParse(projectId).success || !b.success || !m.success) return BAD_INPUT;
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await createNote(supabase, createAdminClient(), { userId, projectId, body: b.data, mediaId: m.data });
    if (!r.ok) return { error: r.message };
  } catch (e) {
    console.error("[saveNote]", e);
    return FAILED;
  }
  // 共有で受け取ったものを残したら、受け取った控えを消す
  (await cookies()).delete(SHARE_COOKIE);
  refresh(projectId);
  return {};
}

export async function editNote(projectId: string, noteId: string, body: unknown, image: unknown): Promise<NoteActionResult> {
  const b = bodySchema.safeParse(body);
  const i = z.union([z.literal("keep"), uuid, z.null()]).safeParse(image);
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(noteId).success || !b.success || !i.success) return BAD_INPUT;
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await updateNote(supabase, createAdminClient(), { userId, noteId, body: b.data, image: i.data });
    if (!r.ok) return { error: r.message };
  } catch (e) {
    console.error("[editNote]", e);
    return FAILED;
  }
  refresh(projectId);
  return {};
}

export async function removeNote(projectId: string, noteId: string): Promise<NoteActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(noteId).success) return BAD_INPUT;
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    const r = await deleteNote(supabase, createAdminClient(), { userId, noteId });
    if (!r.ok) return { error: r.message };
  } catch (e) {
    console.error("[removeNote]", e);
    return FAILED;
  }
  refresh(projectId);
  return {};
}

// AI を使わずに、メモの本文をそのまま下書きにして、投稿の画面を開く
export async function draftFromNote(projectId: string, noteId: string): Promise<NoteActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(noteId).success) return BAD_INPUT;
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  let to: string;
  try {
    const all = await connectedAccounts(projectId);
    const accounts = Object.fromEntries((Object.entries(all) as [SnsKey, string][]).filter(([sns]) => canPublish(sns)));
    const r = await noteToDraft(supabase, createAdminClient(), { userId, projectId, noteId, accounts });
    if (!r.ok) return { error: r.message };
    to = `/projects/${projectId}/posts/${r.postId}?done=${r.skippedImages ? "note_images_skipped" : "note"}`;
  } catch (e) {
    console.error("[draftFromNote]", e);
    return FAILED;
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(to);
}
