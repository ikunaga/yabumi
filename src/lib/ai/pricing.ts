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

// 予約の見込みに使う、いちばん高い単価（表のモデルと知らないモデルのうち。入力はキャッシュへの書き込みの 1.25 倍で数える）。
// 安全のための判定で別のモデルに回ったとき（fallbacks）も、この単価を超えない
export function maxTextPricePerMillion(): { input: number; output: number } {
  const all = [...Object.values(PRICES), FALLBACK_PRICE];
  return { input: Math.max(...all.map((p) => p.input)) * CACHE_WRITE_MULTIPLIER, output: Math.max(...all.map((p) => p.output)) };
}

// 画像の AI の料金（米ドル。docs/architecture.md の 4.25。Gemini API の料金表 2026-10-30 更新を 2026-11-02 に確かめた）。
// 1K（約 100 万画素）1 枚の値段と、指示文（入力）の 100 万トークンの値段。モデルは環境変数 IMAGE_GEN_MODEL で差し替える。
// 料金が変わったらここと docs/architecture.md の 4.25 を直す
type ImagePrice = { perImage: number; inputPerMillion: number };

const IMAGE_PRICES: Record<string, ImagePrice> = {
  "gemini-nano-banana-2.1": { perImage: 0.0336, inputPerMillion: 1.5 },
  "gemini-3.1-flash-lite-image": { perImage: 0.0336, inputPerMillion: 0.25 },
  "gemini-3.1-flash-image": { perImage: 0.067, inputPerMillion: 0.5 },
};
// 表にないモデルは高めに見積もる（上限を超えない側に倒す）
const FALLBACK_IMAGE_PRICE: ImagePrice = { perImage: 0.134, inputPerMillion: 2 };
// 予約のときの指示文の見込み（1 枚あたり。実際の値で直す）。指示文は 1 枚ごとに送るので、枚数ぶん見込む
// （予約が実際の値を下回らないように。docs/security/2026-11-03_セキュリティ確認.md の L2）
export const RESERVE_INPUT_TOKENS_PER_IMAGE = 1000;

export function imagePrice(model: string): ImagePrice {
  return IMAGE_PRICES[model] ?? FALLBACK_IMAGE_PRICE;
}

export function estimateImageCostUsd(model: string, images: number, inputTokens = RESERVE_INPUT_TOKENS_PER_IMAGE * images): number {
  const p = imagePrice(model);
  return Math.round((images * p.perImage + (inputTokens * p.inputPerMillion) / 1_000_000) * 1_000_000) / 1_000_000;
}
