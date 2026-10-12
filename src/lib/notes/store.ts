import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_IMAGES_PER_POST, MEDIA_BUCKET, USER_QUOTA_BYTES, mediaPath } from "@/lib/media/rules";
import type { SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_NOTE_CHARS, MAX_NOTES_PER_PROJECT } from "./rules";

// ネタ帳のメモの保存・直す・削除・下書きにする（docs/architecture.md の 4.26）。
// user: 利用者の権限（RLS で本人のメモ・プロジェクトだけ）。admin: 画像（media_files は書き込みがサーバーだけ。4.18）

type Db = SupabaseClient<Database>;
export type NoteOutcome<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const NOT_FOUND = { ok: false as const, message: "メモが見つかりません。画面を読み込み直してください。" };

function cleanBody(body: string): string | null {
  const t = body.replace(/\r\n/g, "\n").trim();
  return t.length > MAX_NOTE_CHARS ? null : t;
}

async function removeImageRows(admin: Db, rows: { id: string; storage_path: string }[]) {
  if (!rows.length) return;
  const { error } = await admin.storage.from(MEDIA_BUCKET).remove(rows.map((r) => r.storage_path));
  if (error) console.error("[notes] 画像を消せませんでした", error.message);
  await admin.from("media_files").delete().in("id", rows.map((r) => r.id));
}

// 上げたばかりの画像（どこにも添えていない、本人のもの）をメモに添える
async function attachImage(admin: Db, ownerId: string, noteId: string, mediaId: string): Promise<boolean> {
  const { data } = await admin
    .from("media_files")
    .update({ note_id: noteId })
    .eq("id", mediaId)
    .eq("owner_id", ownerId)
    .is("post_id", null)
    .is("note_id", null)
    .select("id");
  return Boolean(data?.length);
}

async function noteImageRows(admin: Db, ownerId: string, noteIds: string[]) {
  if (!noteIds.length) return [];
  const { data, error } = await admin.from("media_files").select("id, note_id, storage_path, width, height, size_bytes, alt_text").eq("owner_id", ownerId).in("note_id", noteIds);
  if (error) throw error;
  return data;
}

// メモを残す。本文か画像のどちらかが要る
export async function createNote(user: Db, admin: Db, args: { userId: string; projectId: string; body: string; mediaId: string | null }): Promise<NoteOutcome<{ noteId: string }>> {
  const body = cleanBody(args.body);
  if (body === null) return { ok: false, message: `メモは ${MAX_NOTE_CHARS.toLocaleString("ja-JP")} 字までです。` };
  if (!body && !args.mediaId) return { ok: false, message: "ひとこと書くか、画像を選んでください。" };

  const { count } = await user.from("idea_notes").select("id", { count: "exact", head: true }).eq("project_id", args.projectId);
  if ((count ?? 0) >= MAX_NOTES_PER_PROJECT) {
    return { ok: false, message: `ネタ帳のメモが ${MAX_NOTES_PER_PROJECT.toLocaleString("ja-JP")} 件あります。使い終えたメモを削除してから残してください。` };
  }
  if (args.mediaId) {
    const { data: m } = await admin.from("media_files").select("id").eq("id", args.mediaId).eq("owner_id", args.userId).is("post_id", null).is("note_id", null).maybeSingle();
    if (!m) return { ok: false, message: "画像が見つかりません。もう一度選んでください。" };
  }

  // RLS で、本人のプロジェクトにだけ入る
  const { data: note, error } = await user.from("idea_notes").insert({ project_id: args.projectId, body }).select("id").single();
  if (error || !note) return { ok: false, message: "プロジェクトが見つかりません。画面を読み込み直してください。" };
  if (args.mediaId && !(await attachImage(admin, args.userId, note.id, args.mediaId))) {
    await user.from("idea_notes").delete().eq("id", note.id);
    return { ok: false, message: "画像が見つかりません。もう一度選んでください。" };
  }
  return { ok: true, noteId: note.id };
}

// メモを直す。image: "keep" はそのまま、null は外す（すぐ消す）、id は新しく上げた画像に替える
export async function updateNote(user: Db, admin: Db, args: { userId: string; noteId: string; body: string; image: "keep" | string | null }): Promise<NoteOutcome> {
  const body = cleanBody(args.body);
  if (body === null) return { ok: false, message: `メモは ${MAX_NOTE_CHARS.toLocaleString("ja-JP")} 字までです。` };
  const { data: note } = await user.from("idea_notes").select("id").eq("id", args.noteId).maybeSingle();
  if (!note) return NOT_FOUND;
  const current = await noteImageRows(admin, args.userId, [note.id]);
  const willHaveImage = args.image === "keep" ? current.length > 0 : args.image !== null;
  if (!body && !willHaveImage) return { ok: false, message: "ひとこと書くか、画像を選んでください。" };

  const { error } = await user.from("idea_notes").update({ body }).eq("id", note.id);
  if (error) return { ok: false, message: "保存できませんでした。時間をおいてもう一度お試しください。" };
  if (args.image !== "keep") {
    const old = current.filter((r) => r.id !== args.image);
    await removeImageRows(admin, old);
    if (args.image && !current.some((r) => r.id === args.image) && !(await attachImage(admin, args.userId, note.id, args.image))) {
      return { ok: false, message: "画像が見つかりません。もう一度選んでください。" };
    }
  }
  return { ok: true };
}

// メモを削除する。添えた画像もすぐに消す（そのメモから作った投稿の画像は、投稿の側に別にあるので残る）
export async function deleteNote(user: Db, admin: Db, args: { userId: string; noteId: string }): Promise<NoteOutcome> {
  const { data: note } = await user.from("idea_notes").select("id").eq("id", args.noteId).maybeSingle();
  if (!note) return NOT_FOUND;
  const images = await noteImageRows(admin, args.userId, [note.id]);
  const { error } = await user.from("idea_notes").delete().eq("id", note.id);
  if (error) return { ok: false, message: "削除できませんでした。時間をおいてもう一度お試しください。" };
  await removeImageRows(admin, images);
  return { ok: true };
}

// メモの画像を、投稿の画像として写す（メモの画像はメモに残す。投稿の画像は 4.18 の決まりで、送り終えて 30 日で消える）。
// 投稿にすでにある画像の後ろに足す。容量や枚数を超えるときは写さず、写せなかった枚数を返す
export async function copyNoteImagesToPost(admin: Db, ownerId: string, postId: string, noteIds: string[]): Promise<{ copied: number; skipped: number }> {
  const rows = await noteImageRows(admin, ownerId, noteIds);
  if (!rows.length) return { copied: 0, skipped: 0 };
  // メモを選んだ順に並べる
  rows.sort((a, b) => noteIds.indexOf(a.note_id!) - noteIds.indexOf(b.note_id!));
  const { count } = await admin.from("media_files").select("id", { count: "exact", head: true }).eq("post_id", postId);
  const { data: used } = await admin.rpc("media_usage_bytes", { p_owner_id: ownerId });
  let position = count ?? 0;
  let total = Number(used ?? 0);
  let copied = 0;
  for (const r of rows) {
    if (position >= MAX_IMAGES_PER_POST || total + r.size_bytes > USER_QUOTA_BYTES) break;
    const path = mediaPath(ownerId, crypto.randomUUID());
    const { error: copyError } = await admin.storage.from(MEDIA_BUCKET).copy(r.storage_path, path);
    if (copyError) {
      console.error("[notes] 画像を写せませんでした", copyError.message);
      break;
    }
    const { error } = await admin
      .from("media_files")
      .insert({ owner_id: ownerId, post_id: postId, storage_path: path, position, alt_text: r.alt_text, width: r.width, height: r.height, size_bytes: r.size_bytes });
    if (error) {
      await admin.storage.from(MEDIA_BUCKET).remove([path]);
      throw error;
    }
    position += 1;
    total += r.size_bytes;
    copied += 1;
  }
  return { copied, skipped: rows.length - copied };
}

// メモに「投稿にした」の印を付け、その投稿へのリンクを残す
export async function markNotesUsed(user: Db, noteIds: string[], postId: string) {
  if (!noteIds.length) return;
  const { error } = await user.from("idea_notes").update({ used_at: new Date().toISOString(), post_id: postId }).in("id", noteIds);
  if (error) throw error;
}

// AI を使わずに、メモの本文をそのまま投稿の下書きにする。送り先は、作成画面と同じく、つないで送れる SNS
export async function noteToDraft(
  user: Db,
  admin: Db,
  args: { userId: string; projectId: string; noteId: string; accounts: Partial<Record<SnsKey, string>> },
): Promise<NoteOutcome<{ postId: string; skippedImages: number }>> {
  const { data: note } = await user.from("idea_notes").select("id, body, project_id").eq("id", args.noteId).eq("project_id", args.projectId).maybeSingle();
  if (!note) return NOT_FOUND;
  const targets = (Object.entries(args.accounts) as [SnsKey, string][]).map(([sns, id]) => ({ sns, title: null, body_override: null, social_account_id: id }));
  const { data: postId, error } = await user.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: args.projectId,
    p_body: note.body,
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: targets,
  });
  if (error || !postId) return { ok: false, message: "下書きを保存できませんでした。時間をおいてもう一度お試しください。" };
  const { skipped } = await copyNoteImagesToPost(admin, args.userId, postId, [note.id]);
  await markNotesUsed(user, [note.id], postId);
  return { ok: true, postId, skippedImages: skipped };
}
