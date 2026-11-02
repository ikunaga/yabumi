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
