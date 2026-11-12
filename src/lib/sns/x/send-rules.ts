import { formatUsd, xPostCostUsd } from "./pricing";

// X をいま送ったら、月の上限（利用者ごと・yabumi 全体）に当たるか（PMO の通しテストで、送ったあとで初めて上限がわかった件）。
// 送信ジョブの reserve_sns_spend（20261011390000_x_post_user_cap）と同じ比べ方「今月の額 ＋ この投稿 > 上限」で、利用者ごとを先に見る。
// 画面からも読むので、サーバー専用のものを import しない。額を読むのは send-verdict.ts（サーバー）

export type XOver = "user" | "global";

export function judgeXSend(a: { userSpentUsd: number; totalSpentUsd: number; costUsd: number; userBudgetUsd: number | null; budgetUsd: number | null }): XOver | null {
  if (a.userBudgetUsd !== null && a.userSpentUsd + a.costUsd > a.userBudgetUsd) return "user";
  if (a.budgetUsd !== null && a.totalSpentUsd + a.costUsd > a.budgetUsd) return "global";
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

// 「X は手で投稿する」を選んで送った配信先の印（error_message に入れる。送信ジョブは失敗の配信先を取り出さないので、自動では送らない）
export const X_BY_HAND_MESSAGE = "X は手で投稿することにしたので、自動では送りません。下の「X に手で投稿する」から投稿して記録できます。";

// 「X は手で投稿する」を選んだ配信先か（失敗ではない。概要の要確認・投稿の札・カレンダーの数・送信の結果で「失敗」に数えない）。判定はここだけ
export function isXByHand(t: { sns: string; status: string; error_message: string | null }): boolean {
  return t.sns === "x" && t.status === "failed" && t.error_message === X_BY_HAND_MESSAGE;
}

// DB で、失敗の配信先から「手で投稿する」を除く条件（PostgREST の or。送信ジョブの失敗には必ず理由の文が入るが、空でも失敗に数える）
export const NOT_X_BY_HAND_FILTER = `error_message.is.null,error_message.neq."${X_BY_HAND_MESSAGE}"`;
