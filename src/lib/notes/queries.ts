import "server-only";
import { PREVIEW_URL_SECONDS } from "@/lib/media/rules";
import { signedUrls } from "@/lib/media/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MAX_NOTES_PER_PROJECT, type IdeaNote } from "./rules";

// プロジェクトのネタ帳のメモ（新しい順）。RLS で本人のものだけ。画像のプレビューの URL はサーバーで作る（4.18）
export async function listNotes(projectId: string, opts: { unusedOnly?: boolean } = {}): Promise<IdeaNote[]> {
  const supabase = await createClient();
  // 画像は media_files.note_id でつながる（1 枚まで）
  let q = supabase
    .from("idea_notes")
    .select("id, project_id, body, used_at, post_id, created_at, media_files(id, storage_path, width, height)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(MAX_NOTES_PER_PROJECT);
  if (opts.unusedOnly) q = q.is("used_at", null);
  const { data: notes, error } = await q;
  if (error) throw error;
  if (!notes.length) return [];
  const media = notes.flatMap((n) => n.media_files.slice(0, 1));
  const urls = await signedUrls(createAdminClient(), media.map((m) => m.storage_path), PREVIEW_URL_SECONDS);
  return notes.map((n) => {
    const m = n.media_files[0];
    return {
      id: n.id,
      projectId: n.project_id,
      body: n.body,
      usedAt: n.used_at,
      postId: n.post_id,
      createdAt: n.created_at,
      image: m ? { id: m.id, previewUrl: urls.get(m.storage_path) ?? null, width: m.width, height: m.height } : null,
    };
  });
}
