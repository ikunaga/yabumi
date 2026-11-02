import { z } from "zod";
import { MAX_ALT_LENGTH, MAX_IMAGES_PER_POST } from "@/lib/media/rules";
import { MAX_NOTES_PER_POST } from "@/lib/notes/rules";
import { SNS_KEYS, type SnsKey } from "@/lib/sns";

// now: 今すぐ送る
export const saveIntent = z.enum(["draft", "schedule", "now"]);

export const savePostInputSchema = z.object({
  projectId: z.uuid(),
  postId: z.uuid().nullable(),
  body: z.string().max(10000, "本文は 10,000 文字以内にしてください"),
  targets: z
    .array(
      z.object({
        sns: z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]),
        bodyOverride: z.string().max(10000).nullable(),
        // 長文の SNS（note・Substack）のタイトル
        title: z.string().max(200).nullable().optional(),
      }),
    )
    .max(SNS_KEYS.length),
  // 添える画像（並び順）。画像はブラウザから Storage に上げて確かめ済みのもの（docs/architecture.md の 4.18）
  media: z
    .array(z.object({ id: z.uuid(), altText: z.string().max(MAX_ALT_LENGTH, `画像の説明文は ${MAX_ALT_LENGTH} 字までです`) }))
    .max(MAX_IMAGES_PER_POST)
    .default([]),
  // 本文のストアなどの URL を、配信先ごとの短縮リンクにする（docs/architecture.md の 4.22、決定 D20。初期値はオン）
  shortLinks: z.boolean().default(true),
  // 日本時間の "YYYY-MM-DDTHH:mm"。空なら日付なし
  plannedAt: z.string(),
  intent: saveIntent,
  // ロードマップのやることから作った投稿（docs/architecture.md の 4.23）。同じプロジェクトのやることだけ（DB のトリガーで守る）
  roadmapItemId: z.uuid().nullable().optional(),
  // 「ネタ帳から」で本文に入れたメモ。保存したら「投稿にした」の印を付ける（同じプロジェクトの、まだ使っていないメモだけ）
  noteIds: z.array(z.uuid()).max(MAX_NOTES_PER_POST).default([]),
});

export type SavePostInput = z.input<typeof savePostInputSchema>;

export type SavePostResult = {
  error?: string;
  // 欄ごとのエラー
  fieldErrors?: { body?: string; plannedAt?: string; targets?: string; media?: string };
  // 今すぐ送る: 保存できた投稿。画面は続けて sendSavedPost で送り、送っている間は送り先ごとの進み具合を読む（4.36）
  sendPostId?: string;
};
