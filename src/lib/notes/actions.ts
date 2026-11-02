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
import { PREVIEW_URL_SECONDS } from "@/lib/media/rules";
import { signedUrls } from "@/lib/media/store";
import { listNotes } from "./queries";
import { MAX_NOTE_CHARS, MAX_NOTES_FOR_COMPOSE, type IdeaNote } from "./rules";
import { SHARE_COOKIE } from "./share";
import { copyNoteImageForCompose, createNote, deleteNote, noteToDraft, updateNote } from "./store";

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
// imageSkipped: 本文だけで残し、画像は添えられなかった（画面で知らせる）
export async function saveNote(projectId: string, body: unknown, mediaId: unknown): Promise<NoteActionResult & { imageSkipped?: boolean }> {
  const b = bodySchema.safeParse(body);
  const m = uuid.nullable().safeParse(mediaId);
  if (!uuid.safeParse(projectId).success || !b.success || !m.success) return BAD_INPUT;
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  let imageSkipped = false;
  try {
    const r = await createNote(supabase, createAdminClient(), { userId, projectId, body: b.data, mediaId: m.data });
    if (!r.ok) return { error: r.message };
    imageSkipped = Boolean(r.imageSkipped);
  } catch (e) {
    console.error("[saveNote]", e);
    return FAILED;
  }
  // 共有で受け取ったものを残したら、受け取った控えを消す
  (await cookies()).delete(SHARE_COOKIE);
  refresh(projectId);
  return imageSkipped ? { imageSkipped } : {};
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

// 「投稿をつくる」の「ネタ帳から」で選べるメモ（まだ投稿にしていないもの、新しい順）
export async function notesForCompose(projectId: string): Promise<{ notes?: IdeaNote[]; error?: string }> {
  if (!uuid.safeParse(projectId).success) return BAD_INPUT;
  const { userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    return { notes: await listNotes(projectId, { unusedOnly: true, limit: MAX_NOTES_FOR_COMPOSE }) };
  } catch (e) {
    console.error("[notesForCompose]", e);
    return { error: "ネタ帳を読み込めませんでした。時間をおいてもう一度お試しください。" };
  }
}

export type ComposeNoteImage = { id: string; previewUrl: string | null; altText: string; width: number; height: number; sizeBytes: number };

// 選んだメモの画像を、投稿に添える画像として写す（画像がなければ image: null）
export async function noteImageForCompose(projectId: string, noteId: string): Promise<{ image?: ComposeNoteImage | null; error?: string }> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(noteId).success) return BAD_INPUT;
  const { supabase, userId } = await currentUser();
  if (!userId) return { error: "ログインし直してください。" };
  const admin = createAdminClient();
  try {
    const r = await copyNoteImageForCompose(supabase, admin, { userId, projectId, noteId });
    if (!r.ok) return { error: r.message };
    if (!r.image) return { image: null };
    const urls = await signedUrls(admin, [r.image.storagePath], PREVIEW_URL_SECONDS);
    const { storagePath, ...rest } = r.image;
    return { image: { ...rest, previewUrl: urls.get(storagePath) ?? null } };
  } catch (e) {
    console.error("[noteImageForCompose]", e);
    return { error: "メモの画像を写せませんでした。時間をおいてもう一度お試しください。" };
  }
}
