import { hasXUrl } from "@/lib/sns/x-text";

// X の API の単価（米ドル、2026-10-11 時点。https://docs.x.com/x-api/getting-started/pricing）。
// 画面（作成画面の費用の案内）からも読むので、サーバー専用のものを import しない
export const X_PRICE_USD = {
  post: 0.015,
  post_with_url: 0.2,
  user_read: 0.01,
  // 画像の代わりの文（media metadata）。1 枚につき 1 回。画像のアップロードそのものは料金表にない（2026-10-11）
  media_metadata: 0.005,
  // 数字を読む（docs/architecture.md の 4.22）。投稿の数字は投稿 1 件、フォロワー数はユーザー 1 件の読み取り
  metrics_read: 0.005,
  followers_read: 0.01,
} as const;

export type XOperation = keyof typeof X_PRICE_USD;

// 決定 D16 の月の上限の既定値。X_MONTHLY_BUDGET_USD で変えられる
export const X_DEFAULT_MONTHLY_BUDGET_USD = 3;

// 利用者ごとの、X の数字の月の上限の既定値（米ドル。4.22 の見込みは 1 人 月 約 $0.64）。X_METRICS_USER_MONTHLY_USD で変えられる
export const X_METRICS_DEFAULT_USER_MONTHLY_USD = 1;

// 利用者ごとの、X の投稿まわり（投稿・投稿がまだあるかの確認・つなぐときの読み取り）の月の上限の既定値（米ドル）。
// X_POST_USER_MONTHLY_USD で変えられる。1 人が矢書全体の上限を使い切らないため（docs/cost-review.md の C4〜C6 で料金プランごとに変わる前提）
export const X_POST_DEFAULT_USER_MONTHLY_USD = 1;

export function xPostOperation(text: string): "post" | "post_with_url" {
  return hasXUrl(text) ? "post_with_url" : "post";
}

// 1 回の投稿の費用（代わりの文を付けた画像の分を足す）。altCount は代わりの文がある画像の枚数
export function xPostCostUsd(text: string, altCount = 0): number {
  return X_PRICE_USD[xPostOperation(text)] + altCount * X_PRICE_USD.media_metadata;
}

export function formatUsd(usd: number): string {
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}
