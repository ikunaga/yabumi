import { hasXUrl } from "@/lib/sns/x-text";

// X の API の単価（米ドル、2026-10-11 時点。https://docs.x.com/x-api/getting-started/pricing）。
// 画面（作成画面の費用の案内）からも読むので、サーバー専用のものを import しない
export const X_PRICE_USD = {
  post: 0.015,
  post_with_url: 0.2,
  user_read: 0.01,
  // 画像の代わりの文（media metadata）。1 枚につき 1 回。画像のアップロードそのものは料金表にない（2026-10-11）
  media_metadata: 0.005,
} as const;

export type XOperation = keyof typeof X_PRICE_USD;

// 決定 D16 の月の上限の既定値。X_MONTHLY_BUDGET_USD で変えられる
export const X_DEFAULT_MONTHLY_BUDGET_USD = 3;

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
