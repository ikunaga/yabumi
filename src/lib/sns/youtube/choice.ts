import { z } from "zod";

// YouTube に送るときに、画面から受け取る利用者が選んだもの（docs/design/youtube.md の 4.）。同意の時刻・文の指紋・チャンネル名はサーバーが決める
export const YOUTUBE_PRIVACY = ["public", "unlisted", "private"] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY)[number];

export const YOUTUBE_PRIVACY_LABEL: Record<YouTubePrivacy, string> = {
  public: "公開（だれでも見られる）",
  unlisted: "限定公開（URL を知っている人だけ）",
  private: "非公開（自分だけ）",
};

// 選べるカテゴリ（videoCategories.list?regionCode=JP のうち、yabumi の利用者がよく使うもの）。初めはブログ（22）
export const YOUTUBE_CATEGORIES = [
  { id: "22", label: "ブログ" },
  { id: "26", label: "ハウツーとスタイル" },
  { id: "27", label: "教育" },
  { id: "24", label: "エンターテイメント" },
  { id: "28", label: "科学と技術" },
  { id: "15", label: "ペットと動物" },
] as const;
export const DEFAULT_YOUTUBE_CATEGORY = "22";

export const youtubeChoiceSchema = z
  .object({
    // 公開範囲と子ども向けかは、選ぶまで null（Y6・COPPA）
    privacyStatus: z.enum(YOUTUBE_PRIVACY).nullable(),
    madeForKids: z.boolean().nullable(),
    syntheticMedia: z.boolean(),
    categoryId: z.enum(YOUTUBE_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
  })
  .strict();
export type YouTubeChoice = z.infer<typeof youtubeChoiceSchema>;

export const EMPTY_YOUTUBE_CHOICE: YouTubeChoice = { privacyStatus: null, madeForKids: null, syntheticMedia: false, categoryId: DEFAULT_YOUTUBE_CATEGORY };

// 選び終えていないところ（送る前の確かめ。画面とサーバーで同じ）
export function youtubeChoiceProblem(c: YouTubeChoice | undefined): string | null {
  if (!c) return "YouTube の公開範囲などを選んでから送ってください";
  if (!c.privacyStatus) return "YouTube の公開範囲を選んでください";
  if (c.madeForKids === null) return "YouTube の動画が子ども向けかどうかを選んでください";
  return null;
}

// ショートになるか（3 分以内で、正方形か縦長。API に「ショートにする」項目はなく、YouTube が長さと縦横で決める）
export function isShortsShape(v: { durationMs: number; width: number; height: number }): boolean {
  return v.durationMs <= 180_000 && v.width > 0 && v.height >= v.width;
}
