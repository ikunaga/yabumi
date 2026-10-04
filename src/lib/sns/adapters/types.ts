import type { SnsKey } from "@/lib/sns";

// SNS アダプター: SNS ごとの違いをここに閉じ込める（docs/architecture.md の 4.1）。
// 送信ジョブや画面はこの形だけを知っていればよい。

export type AdapterAccount = { externalId: string; accessToken: string };

export type PublishResult = { externalPostId: string; url: string | null };

// 失敗の種類。送信ジョブはこれを見て、やり直すか・アカウントを「期限切れ」にするかを決める
// - retryable: 一時的な失敗（回数制限、SNS 側の障害、通信エラー）。間をあけてやり直す
// - auth: トークンが無効。アカウントを期限切れにし、つなぎ直してもらう
// - permanent: 内容の問題など、やり直しても変わらない
// - unknown: 送れたかどうかわからない（公開の途中で通信が切れたなど）。二重投稿を避けるため、やり直さない
export type PublishErrorKind = "retryable" | "auth" | "permanent" | "unknown";

export class SnsPublishError extends Error {
  constructor(
    readonly kind: PublishErrorKind,
    // 画面に出す、利用者向けの説明
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = "SnsPublishError";
  }
}

export interface SnsAdapter {
  sns: SnsKey;
  publishText(account: AdapterAccount, text: string): Promise<PublishResult>;
  deletePost(account: AdapterAccount, externalPostId: string): Promise<void>;
  // 長期トークンの延長。延長が要らない・できない SNS は持たない
  refreshToken?(accessToken: string, now: Date): Promise<{ accessToken: string; expiresAt: Date }>;
  shouldRefresh?(expiresAt: Date, now: Date): boolean;
}
