import { z } from "zod";

// 自動の投稿で AI が返す形（docs/design/auto-post.md の 2.4）。1 回に 1 案。SNS ごとの文か、材料だけでは書けない理由。
// pillar・concern は次の回の切り口を変えるために記録する（返事の形の JSON スキーマが REQUEST_OVERHEAD_TOKENS より小さいことは tests/ai-budget.test.ts が確かめる）
export const autoPostDraftSchema = z.object({
  texts: z.array(z.object({ sns: z.string(), text: z.string() })),
  pillar: z.string(),
  concern: z.enum(["health", "ambition", "relationship", "money", "none"]),
  cannot_write: z.string().nullable(),
  // 画像に重ねる見出し（回し方で「AI が書く」を選んだときだけ。docs/design/auto-sample-image.md の 11.）。いらないときは null
  headline: z.string().nullable(),
});
export type AutoPostDraft = z.infer<typeof autoPostDraftSchema>;
