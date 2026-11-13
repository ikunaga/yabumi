import type { AttachedImage } from "@/components/posts/image-attachments";
import type { Adjustments } from "@/lib/media/adjust";
import type { HeadlineSettings } from "@/lib/media/headline";
import type { EditKind } from "@/lib/media/image-edit";
import type { DraftImage } from "./post-draft";

// 書きかけの控えの画像と、整えたときの元のたどり方（docs/architecture.md の 4.62・4.65）。
// 控えるのは id と説明文に加え、画像に文字が入っているか（text）と、元の画像・最後に描き直した元の id と整え方（見出しの設定・調整の値）。
// 戻すときは、それらの id もサーバーで本人のもの・戻せるものか確かめて読み直し、元がそろえば「見出しを直す」「元に戻す」も戻す。
// 元が消えていたら（添えていない画像は 1 日で片付ける）、整え方は戻さない。文字が入っているかはわかるので、見出しの入口はそれで決める

export function toDraftImage(i: AttachedImage): DraftImage {
  return {
    id: i.id,
    altText: i.altText,
    ...(i.text !== undefined ? { text: i.text } : {}),
    ...(i.original ? { originalId: i.original.id } : {}),
    ...(i.edit ? { edit: { kind: i.edit.kind, baseId: i.edit.base.id, ...(i.edit.adjust ? { adjust: i.edit.adjust } : {}), ...(i.edit.headline ? { headline: i.edit.headline } : {}) } } : {}),
  };
}

// 投稿の保存に渡す形（4.68）。元と描き直した元の両方があるときだけ、整え方を渡す
export function toSavedMedia(i: AttachedImage): { id: string; altText: string; originalId?: string; editBaseId?: string; edit?: { kind: EditKind; adjust?: Adjustments; headline?: HeadlineSettings }; hasText?: boolean } {
  return {
    id: i.id,
    altText: i.altText,
    ...(i.text !== undefined ? { hasText: i.text } : {}),
    ...(i.original && i.edit
      ? { originalId: i.original.id, editBaseId: i.edit.base.id, edit: { kind: i.edit.kind, ...(i.edit.adjust ? { adjust: i.edit.adjust } : {}), ...(i.edit.headline ? { headline: i.edit.headline } : {}) } }
      : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 読み直す id（画像と、元の画像・描き直した元。重ならないように。形の違う id は送らない）
export function draftImageIds(images: DraftImage[]): string[] {
  const ids = images.flatMap((i) => [i.id, i.originalId, i.edit?.baseId]).filter((id): id is string => typeof id === "string" && UUID.test(id));
  return [...new Set(ids)];
}

type Loaded = Omit<AttachedImage, "altText" | "original" | "edit" | "text"> & { altText: string };

// 読み直した画像から、添えた画像の並びを組み立て直す。missing: 戻せなかった（添えた）画像の枚数
export function rebuildDraftImages(want: DraftImage[], loaded: Loaded[]): { images: AttachedImage[]; missing: number } {
  const byId = new Map(loaded.map((l) => [l.id, l]));
  const plain = (id: string | undefined): AttachedImage | null => {
    const l = id ? byId.get(id) : undefined;
    return l ? { ...l } : null;
  };
  const images: AttachedImage[] = [];
  for (const w of want) {
    const l = byId.get(w.id);
    if (!l) continue;
    const image: AttachedImage = { ...l, altText: typeof w.altText === "string" ? w.altText : l.altText };
    if (typeof w.text === "boolean") image.text = w.text;
    const original = plain(w.originalId);
    const base = plain(w.edit?.baseId);
    // 元と描き直した元の両方がそろったときだけ、整え方を戻す（片方だけでは「元に戻す」「直す」の描き直しが食い違う）
    if (original && w.edit && base && isEditKind(w.edit.kind)) {
      image.original = original;
      image.edit = { kind: w.edit.kind, base, ...(w.edit.adjust ? { adjust: w.edit.adjust as Adjustments } : {}), ...(w.edit.headline ? { headline: w.edit.headline as HeadlineSettings } : {}) };
    }
    images.push(image);
  }
  return { images, missing: want.length - images.length };
}

function isEditKind(k: unknown): k is EditKind {
  return k === "aspect" || k === "adjust" || k === "headline";
}
