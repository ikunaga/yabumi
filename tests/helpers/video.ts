// 動画のテスト用の部品（docs/design/video.md）。YouTube・TikTok の送信の結合テストからも使う。
// seedPostVideo: 確かめを通さずに、投稿に添えた動画（行とファイル）を入れる。tusUpload: ブラウザと同じく TUS で上げる
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { VIDEO_BUCKET, videoPath } from "@/lib/media/video-rules";
import { testEnv } from "./env";
import { clientOf } from "./supabase";
import { testMp4 } from "./mp4";

const url = testEnv("SUPABASE_TEST_URL", "NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = testEnv("SUPABASE_TEST_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

// 投稿に動画を添えた状態を作る。bytes を渡さなければ、箱の形だけの小さな MP4。postId が null なら、添えていない動画
export async function seedPostVideo(
  admin: SupabaseClient<Database>,
  o: { ownerId: string; postId: string | null; bytes?: Uint8Array; durationMs?: number; width?: number; height?: number },
): Promise<{ mediaId: string; path: string; bytes: Uint8Array }> {
  const durationMs = o.durationMs ?? 10_000;
  const bytes = o.bytes ?? testMp4({ durationMs, width: o.width, height: o.height });
  const path = videoPath(o.ownerId, crypto.randomUUID());
  const { error: upError } = await admin.storage.from(VIDEO_BUCKET).upload(path, bytes, { contentType: "video/mp4" });
  if (upError) throw upError;
  const { data, error } = await admin
    .from("media_files")
    .insert({ owner_id: o.ownerId, post_id: o.postId, storage_path: path, kind: "video", duration_ms: durationMs, width: o.width ?? 1080, height: o.height ?? 1920, size_bytes: bytes.length })
    .select("id")
    .single();
  if (error) throw error;
  return { mediaId: data.id, path, bytes };
}

// TUS（再開できるアップロード）で、利用者のログインのまま上げる（画面と同じ。Storage の insert のポリシーを通す）。chunk ずつ PATCH する。
// 返り値は最後の応答の状態。as を省くと、置き場所の最初のフォルダ（利用者の ID）の利用者で上げる
export async function tusUpload(o: { path: string; bytes: Uint8Array; chunk?: number; bucket?: string; as?: string; upsert?: boolean }): Promise<number> {
  const meta = (k: string, v: string) => `${k} ${Buffer.from(v).toString("base64")}`;
  const jwt = (await clientOf(o.as ?? o.path.split("/")[0]).auth.getSession()).data.session?.access_token;
  const headers: Record<string, string> = { apikey: publishableKey, "Tus-Resumable": "1.0.0", Authorization: `Bearer ${jwt}`, "x-upsert": o.upsert ? "true" : "false" };
  const create = await fetch(`${url}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      ...headers,
      "Upload-Length": String(o.bytes.length),
      "Upload-Metadata": [meta("bucketName", o.bucket ?? VIDEO_BUCKET), meta("objectName", o.path), meta("contentType", "video/mp4")].join(","),
    },
  });
  if (create.status !== 201) return create.status;
  const location = create.headers.get("location");
  if (!location) return 0;
  const target = new URL(location, url).toString();
  const chunk = o.chunk ?? 6 * 1024 * 1024;
  let last = create.status;
  for (let at = 0; at < o.bytes.length; at += chunk) {
    const part = o.bytes.subarray(at, Math.min(at + chunk, o.bytes.length));
    const res = await fetch(target, {
      method: "PATCH",
      headers: { ...headers, "Upload-Offset": String(at), "Content-Type": "application/offset+octet-stream" },
      body: Buffer.from(part),
    });
    last = res.status;
    if (res.status !== 204) return res.status;
  }
  return last;
}
