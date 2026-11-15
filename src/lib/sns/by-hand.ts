// 「手で投稿する」を選んだ配信先の印（X・TikTok・YouTube）。配信先を failed にし、error_message にこの文を入れる。
// 送信ジョブは failed を取り出さないので、自動では送らない。失敗ではないので、概要の要確認・投稿の札・カレンダーの数・送信の結果で「失敗」に数えない。
// SQL では public.by_hand_message に同じ文を置いている（20261115090000_tiktok_by_hand・20261115110000_youtube。一致は tests/tiktok-by-hand.integration.test.ts で確かめる）
export const BY_HAND_SNS = ["x", "tiktok", "youtube"] as const;
export type ByHandSns = (typeof BY_HAND_SNS)[number];

export const BY_HAND_MESSAGE: Record<ByHandSns, string> = {
  x: "X は手で投稿することにしたので、自動では送りません。下の「X に手で投稿する」から投稿して記録できます。",
  tiktok: "TikTok は手で投稿することにしたので、自動では送りません。下の「TikTok に手で投稿する」から投稿して記録できます。",
  youtube: "YouTube は手で投稿することにしたので、自動では送りません。下の「YouTube に手で投稿する」から投稿して記録できます。",
};

export const isByHandSns = (sns: string): sns is ByHandSns => (BY_HAND_SNS as readonly string[]).includes(sns);

// 「手で投稿する」を選んだ配信先か。判定はここだけ
export function isByHand(t: { sns: string; status: string; error_message: string | null }): boolean {
  return t.status === "failed" && isByHandSns(t.sns) && t.error_message === BY_HAND_MESSAGE[t.sns];
}

// DB で、失敗の配信先から「手で投稿する」を除く条件（PostgREST の or。送信ジョブの失敗には必ず理由の文が入るが、空でも失敗に数える）
export const NOT_BY_HAND_FILTER = `error_message.is.null,and(${BY_HAND_SNS.map((s) => `error_message.neq."${BY_HAND_MESSAGE[s]}"`).join(",")})`;
