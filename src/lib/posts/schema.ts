import { z } from "zod";
import { MAX_ALT_LENGTH, MAX_IMAGES_PER_POST } from "@/lib/media/rules";
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
  // 添える画像（並び順）。画像はブラウザから Storage に上げて確かめ済みのもの（docs/architecture.md の 4.17）
  media: z
    .array(z.object({ id: z.uuid(), altText: z.string().max(MAX_ALT_LENGTH, `代わりの文は ${MAX_ALT_LENGTH} 字までです`) }))
    .max(MAX_IMAGES_PER_POST)
    .default([]),
  // 日本時間の "YYYY-MM-DDTHH:mm"。空なら日付なし
  plannedAt: z.string(),
  intent: saveIntent,
});

export type SavePostInput = z.input<typeof savePostInputSchema>;

export type SavePostResult = {
  error?: string;
  // 欄ごとのエラー
  fieldErrors?: { body?: string; plannedAt?: string; targets?: string; media?: string };
};
