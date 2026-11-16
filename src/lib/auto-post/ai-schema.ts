import { z } from "zod";

// 自動の投稿で AI が返す形（docs/design/auto-post.md の 2.4）。1 回に 1 案。SNS ごとの文か、材料だけでは書けない理由。
// 本物の AI の呼び出しは feat/auto-post-engine で作る（そのときに中身を足してよい。返事の形の JSON スキーマが REQUEST_OVERHEAD_TOKENS より小さいことは tests/ai-budget.test.ts が確かめる）
export const autoPostDraftSchema = z.object({
  texts: z.array(z.object({ sns: z.string(), text: z.string() })),
  cannot_write: z.string().nullable(),
});
