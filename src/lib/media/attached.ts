import type { AttachedImage } from "@/components/posts/image-attachments";
import type { Database } from "@/lib/supabase/database.types";
import type { Adjustments } from "./adjust";
import { mediaEditSchema } from "./edit-schema";
import type { HeadlineSettings } from "./headline";

// 保存した投稿の画像の行から、作成画面の画像の形にする（4.68）。整えた画像は、元の画像と最後に描き直した元（sources）から
// 「見出しを直す」「元に戻す」が出せる形にする

export type MediaRow = Database["public"]["Tables"]["media_files"]["Row"];

export function toAttached(f: MediaRow, urls: Map<string, string>, sources: Map<string, MediaRow>): AttachedImage {
  const plain = (r: MediaRow): AttachedImage => ({ id: r.id, previewUrl: urls.get(r.storage_path) ?? null, altText: r.alt_text, width: r.width, height: r.height, sizeBytes: r.size_bytes, aiGenerated: r.ai_generated, ...(typeof r.has_text === "boolean" ? { text: r.has_text } : {}) });
  const image = plain(f);
  const original = f.original_id ? sources.get(f.original_id) : undefined;
  const base = f.edit_base_id ? sources.get(f.edit_base_id) : undefined;
  const edit = mediaEditSchema.safeParse(f.edit);
  // 元と描き直した元がそろい、整え方の形が正しいときだけ（片方でも欠けたら、整え方は出さない。文字が入っているかは has_text で決まる）
  if (original && base && edit.success) {
    image.original = plain(original);
    image.edit = { kind: edit.data.kind, base: plain(base), ...(edit.data.adjust ? { adjust: edit.data.adjust as Adjustments } : {}), ...(edit.data.headline ? { headline: edit.data.headline as HeadlineSettings } : {}) };
  }
  return image;
}

