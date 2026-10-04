import { z } from "zod";
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
      }),
    )
    .max(SNS_KEYS.length),
  // 日本時間の "YYYY-MM-DDTHH:mm"。空なら日付なし
  plannedAt: z.string(),
  intent: saveIntent,
});

export type SavePostInput = z.infer<typeof savePostInputSchema>;

export type SavePostResult = {
  error?: string;
  // 欄ごとのエラー
  fieldErrors?: { body?: string; plannedAt?: string; targets?: string };
};
