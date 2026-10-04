// Claude API の料金（米ドル / 100 万トークン。2026-09 時点、claude-api スキルの料金表から）。
// 見積もりと上限の判定に使う。料金が変わったらここと docs/architecture.md の 4.9 を直す
type Price = { input: number; output: number; cacheRead: number };

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
};
// 知らないモデル（フォールバック先など）は高めに見積もる
const FALLBACK_PRICE: Price = { input: 5, output: 25, cacheRead: 0.5 };
// キャッシュへの書き込みは入力の 1.25 倍（5 分の TTL）
const CACHE_WRITE_MULTIPLIER = 1.25;

export type TokenUsage = { inputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; outputTokens: number };

export function estimateCostUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const cost =
    (u.inputTokens * p.input + u.cacheWriteTokens * p.input * CACHE_WRITE_MULTIPLIER + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
