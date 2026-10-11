import type { SnsKey } from "@/lib/sns";

// SNS アダプター: SNS ごとの違いをここに閉じ込める（docs/architecture.md の 4.1）。
// 送信ジョブや画面はこの形だけを知っていればよい。

export type AdapterAccount = { externalId: string; accessToken: string };

export type PublishResult = { externalPostId: string; url: string | null };

// 投稿に添える画像（docs/architecture.md の 4.18）。JPEG。URL を取りに来る SNS（Threads）には url を、
// ファイルを送る SNS（X）には load() の中身を渡す。url は送る直前に作る期限つきの署名 URL
export type PublishImage = { url: string; altText: string; load: () => Promise<Uint8Array> };

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

// リフレッシュトークンで取り直した結果。リフレッシュトークンが使い捨ての SNS（X）は新しいものが返る
export type RefreshedTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date };

// 使った分だけ払う SNS（X）の、1 回の投稿の費用（画像の代わりの文の分も含めた合計）
export type PublishCost = { operation: "post" | "post_with_url"; costUsd: number };

// SNS 側で画像の準備に時間がかかる投稿（Threads・Instagram）の、準備の途中の状態。DB の post_targets.sns_container に入る。
// 形はアダプターが決める（コンテナの ID など。トークンは入れない）
export type PrepareState = { [key: string]: unknown };

// 準備の続きを確かめた結果: 公開まで済んだ（done）か、まだ準備中（state。次の回にまた確かめる）
export type ContinueResult = { done: PublishResult } | { state: PrepareState };

export interface SnsAdapter {
  sns: SnsKey;
  // images は並び順。0 枚なら文章だけの投稿
  publishText(account: AdapterAccount, text: string, images?: PublishImage[]): Promise<PublishResult>;
  deletePost(account: AdapterAccount, externalPostId: string): Promise<void>;

  // --- 長期トークンを延長する SNS（Threads） ---
  refreshToken?(accessToken: string, now: Date): Promise<{ accessToken: string; expiresAt: Date }>;
  shouldRefresh?(expiresAt: Date, now: Date): boolean;

  // --- 短いアクセストークンを、リフレッシュトークンで取り直す SNS（X） ---
  // アクセストークンが切れていても、リフレッシュトークンがあれば送れる。取り直しは publisher.ts が 1 回だけになるよう順番を守る
  refreshWithRefreshToken?(refreshToken: string, now: Date): Promise<RefreshedTokens>;
  // 日次のジョブで、リフレッシュトークンが使われないまま古くならないよう取り直す時期か（lastRefreshedAt は最後に取り直した日時）
  shouldRotate?(lastRefreshedAt: Date, now: Date): boolean;

  // --- 画像の準備に時間がかかる SNS（Threads・Instagram）。1 回のジョブの中で待ち続けないための 2 段階の送り方 ---
  // 画像つきの投稿は publishText ではなくこちらを使う（docs/architecture.md の 4.7「1 回のジョブの時間」）。
  // startPublish: コンテナを作り、準備の途中の状態を返す（待たない）。continuePublish: 準備ができていれば公開し、まだなら状態を返す
  startPublish?(account: AdapterAccount, text: string, images: PublishImage[]): Promise<PrepareState>;
  continuePublish?(account: AdapterAccount, state: PrepareState): Promise<ContinueResult>;

  // --- 使った分だけ払う SNS（X）。送る前に費用を記録し、月の上限を守る ---
  publishCost?(text: string, images?: PublishImage[]): PublishCost;
}
