// 外の AI（Gemini の画像・Claude）が、支払い・鍵の問題で使えないとき（docs/architecture.md の 4.25 の ②・4.22「悪用への備え」）。
// 時間をおいても直らないので、利用者には「いま使えない（運営者に知らせた）」と出し、運営者にメールで知らせる（同じ理由は 1 時間に 1 回まで）。
// ここは画面（クライアント）からも読み込まれるので、見分け方と文だけを置く。運営者への知らせは provider-failure-report.ts（サーバーだけ）

export type AiProvider = "gemini" | "anthropic";

export class AiUnavailableError extends Error {
  constructor(
    readonly provider: AiProvider,
    readonly status: number,
  ) {
    super(`${provider} ${status}`);
    this.name = "AiUnavailableError";
  }
}

// Claude が送った頼みを処理せずに断った（4xx。408 を除く。形の誤り・大きすぎる・回数の制限など）。請求されないことがはっきりしているので、
// 上限の予約を消してよい（src/lib/ai/budget.ts）。5xx・タイムアウト・接続が切れたときは請求されたかわからないので、これにしない
export class AiRequestRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AiRequestRejected";
  }
}

// 請求されないことがはっきりしている失敗か（支払い・鍵の問題も、処理の前に断られている）
export function notBilled(e: unknown): boolean {
  return e instanceof AiUnavailableError || e instanceof AiRequestRejected;
}

// 処理されずに断られたとみなす状態番号（408 はサーバー側の時間切れで、途中まで処理されたかわからない）
export function isRejectedStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408;
}

// 支払い・鍵の問題とみなす返事。Anthropic は残高が足りないとき 400 で「credit balance」と返す
export function isUnavailableResponse(provider: AiProvider, status: number, message = ""): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  return provider === "anthropic" && status === 400 && /credit balance/i.test(message);
}

export const AI_UNAVAILABLE_MESSAGE: Record<AiProvider, string> = {
  gemini: "AI の画像はいま使えません（運営者に知らせました）。テンプレートの画像と、手持ちの写真は使えます。",
  anthropic: "AI はいま使えません（運営者に知らせました）。",
};

// 失敗したときに利用者に出す文。支払い・鍵の問題なら「いま使えない」、それ以外は呼ぶ側の文（時間をおいて、など）
export function aiFailureMessage(e: unknown, fallback: string): string {
  return e instanceof AiUnavailableError ? AI_UNAVAILABLE_MESSAGE[e.provider] : fallback;
}
