import { SNS } from "@/lib/sns";
import { X_PRICE_USD, formatUsd, xPostCostUsd } from "./pricing";
import { BY_HAND_MESSAGE } from "@/lib/sns/by-hand";

// X をいま送ったら、月の上限（利用者ごと・yabumi 全体）に当たるか（PMO の通しテストで、送ったあとで初めて上限がわかった件）。
// 送信ジョブの reserve_sns_spend（20261011390000_x_post_user_cap）と同じ比べ方「今月の額 ＋ この投稿 > 上限」で、利用者ごとを先に見る。
// 画面からも読むので、サーバー専用のものを import しない。額を読むのは send-verdict.ts（サーバー）

export type XOver = "user" | "global";

// X の投稿 1 本のいちばん高い額（URL あり＋説明文のある画像を上限の枚数まで）
export const X_MAX_POST_COST_USD = X_PRICE_USD.post_with_url + SNS.x.maxImages * X_PRICE_USD.media_metadata;

// 全体の上限は、この投稿の額によらず、いちばん高い額で判定する（文や画像の枚数を変えて答えを見比べると、
// 全体の残りの額が少しずつわかってしまうため。セキュリティ確認 2026-11-13 の App-L1）。利用者ごとの上限は本人の額なので、この投稿の額で見る。
// 送信ジョブの reserve_sns_spend はこの投稿の額で止めるので、見込みは少し早めに「当たる」と出ることがある（費用は超えない向き）
export function judgeXSend(a: { userSpentUsd: number; totalSpentUsd: number; costUsd: number; userBudgetUsd: number | null; budgetUsd: number | null }): XOver | null {
  if (a.userBudgetUsd !== null && a.userSpentUsd + a.costUsd > a.userBudgetUsd) return "user";
  if (a.budgetUsd !== null && a.totalSpentUsd + X_MAX_POST_COST_USD > a.budgetUsd) return "global";
  return null;
}

// 送る文（タグ込み）と、説明文のある画像の枚数から、この投稿の費用（送信ジョブの adapter.publishCost と同じ）
export const xSendCostUsd = (text: string, altCount: number) => xPostCostUsd(text, altCount);

// 日本時間の年月（"2026-11"）。上限の月の区切りは日本時間（reserve_sns_spend の v_month_start）
export function jstMonth(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

// 送る時刻が、いまより後の月（日本時間）か。後の月なら、その月の額は 0 から数える
export function inLaterJstMonth(at: Date, now: Date): boolean {
  return jstMonth(at) > jstMonth(now);
}

// 送れない理由の文（全体の上限では、ほかの人の額がわからないよう、達したことだけを書く）
export function xOverMessage(over: XOver, a: { costUsd: number; userBudgetUsd: number }): string {
  return over === "user"
    ? `今月の X の自動投稿の上限（1 人 $${a.userBudgetUsd}）に達するので、この投稿は X に自動では送れません（この投稿 ${formatUsd(a.costUsd)}）`
    : "今月の yabumi 全体の X の上限に達しているので、この投稿は X に自動では送れません";
}

// 「X は手で投稿する」の印の文（SNS ごとの表は src/lib/sns/by-hand.ts）
export const X_BY_HAND_MESSAGE = BY_HAND_MESSAGE.x;
