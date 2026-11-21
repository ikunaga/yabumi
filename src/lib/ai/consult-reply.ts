// AI と相談で、返事を作っている印（ai_threads.replying_since・reply_failed_at。20261121120000）の決まりと画面の文。画面からも読むので、サーバーの部品は入れない

// 印の見切り。これより古い印は、サーバーが途中で止まった残りとして扱う（consult のページの maxDuration 120 秒の倍より長く）
export const REPLY_STALE_MS = 5 * 60_000;
export const REPLYING_MESSAGE = "AI が前の返事を作っています。返事が出てから送ってください。";
export const REPLY_FAILED_MESSAGE = "返事を作れませんでした。もう一度送ってください。";

// 印が生きているか（作っている最中か）
export function isReplying(replyingSince: string | null, now: Date): boolean {
  return replyingSince !== null && Date.parse(replyingSince) > now.getTime() - REPLY_STALE_MS;
}
