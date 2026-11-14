import { z } from "zod";
import { PRIVACY_LEVELS } from "./publish";

// TikTok に送るときに、画面から受け取る利用者が選んだもの（docs/design/tiktok.md の 3.）。同意の時刻・文の指紋・AI の印はサーバーが決める
export const tiktokChoiceSchema = z
  .object({
    privacyLevel: z.enum(PRIVACY_LEVELS).nullable(),
    allowComment: z.boolean(),
    commercial: z.boolean(),
    brandOrganic: z.boolean(),
    brandContent: z.boolean(),
    // DIRECT_POST: そのまま投稿する。MEDIA_UPLOAD: TikTok のアプリの受信箱に下書きとして送る（8.）
    mode: z.enum(["DIRECT_POST", "MEDIA_UPLOAD"]),
  })
  .strict();
export type TikTokChoice = z.infer<typeof tiktokChoiceSchema>;
