// 画像を、利用者のログインのまま引換券の場所に上げる（画面と同じ。Storage の insert のポリシーを通す。docs/design/video.md の 11.）。
// 置き場所の最初のフォルダ（利用者の ID）から、その利用者のクライアントを使う。ok と status は前の fetch の形に合わせる
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { clientOf } from "./supabase";

export async function putImage(path: string, bytes: Uint8Array, contentType = "image/jpeg", opts: { as?: string; upsert?: boolean } = {}) {
  const owner = opts.as ?? path.split("/")[0];
  const { error } = await clientOf(owner).storage.from(MEDIA_BUCKET).upload(path, Buffer.from(bytes), { contentType, upsert: opts.upsert ?? false });
  return { ok: !error, error };
}
