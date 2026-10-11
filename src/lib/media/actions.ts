"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_URL_SECONDS } from "./rules";
import { MediaError, discardUnattached, issueUpload, signedUrls, verifyUpload, type MediaFile, type UploadTicket } from "./store";

// 画面から呼ぶ、画像の添付の操作（docs/architecture.md の 4.18）。画像そのものは Vercel の関数を通さず、
// ブラウザが署名つきの URL で Storage に直接上げる。ここでは URL の発行と、上げたあとの確かめだけを行う

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

function failure(e: unknown, fallback: string) {
  if (e instanceof MediaError) return { error: e.userMessage };
  console.error("[media]", e instanceof Error ? e.message : e);
  return { error: fallback };
}

export async function requestImageUpload(): Promise<{ ticket?: UploadTicket; error?: string }> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインし直してください。" };
  try {
    return { ticket: await issueUpload(createAdminClient(), userId) };
  } catch (e) {
    return failure(e, "画像を追加できませんでした。時間をおいてもう一度お試しください。");
  }
}

export type UploadedImage = MediaFile & { previewUrl: string | null };

export async function confirmImageUpload(path: string): Promise<{ image?: UploadedImage; error?: string }> {
  if (typeof path !== "string" || path.length > 200) return { error: "入力の形式が正しくありません。" };
  const userId = await currentUserId();
  if (!userId) return { error: "ログインし直してください。" };
  const admin = createAdminClient();
  try {
    const file = await verifyUpload(admin, userId, path);
    const urls = await signedUrls(admin, [file.storagePath], PREVIEW_URL_SECONDS);
    return { image: { ...file, previewUrl: urls.get(file.storagePath) ?? null } };
  } catch (e) {
    return failure(e, "画像を確かめられませんでした。もう一度選び直してください。");
  }
}

// まだ投稿を保存していない画像を外す。保存した投稿の画像は、投稿を保存したときに消える
export async function discardImage(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const userId = await currentUserId();
  if (!userId) return;
  await discardUnattached(createAdminClient(), userId, id);
}
