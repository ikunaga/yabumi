import "server-only";
import { envReady } from "@/lib/env-check";
import { appUrl } from "@/lib/sns/threads/config";
import type { XConfig } from "./api";
import { X_DEFAULT_MONTHLY_BUDGET_USD, X_METRICS_DEFAULT_USER_MONTHLY_USD, X_POST_DEFAULT_USER_MONTHLY_USD } from "./pricing";

export const X_PATHS = {
  connect: "/sns/x/connect",
  callback: "/sns/x/callback",
} as const;

// X から戻ってくるホスト。ふだんは APP_URL と同じ。X の Developer Console が localhost の Callback URI を受け付けないときだけ、
// ローカルで X_REDIRECT_ORIGIN=https://127.0.0.1:3100 にする（ログインの cookie はホストごとなので、127.0.0.1 でログインし直す）
export function xOrigin(): string {
  return (process.env.X_REDIRECT_ORIGIN || appUrl()).replace(/\/$/, "");
}

// X の Developer Console の「Keys and tokens」にある OAuth 2.0 の Client ID と Client Secret
export function xConfig(): XConfig {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("環境変数 X_CLIENT_ID / X_CLIENT_SECRET が設定されていません。");
  }
  return { clientId, clientSecret, redirectUri: `${xOrigin()}${X_PATHS.callback}` };
}

export function xConfigured(): boolean {
  return envReady("X の接続", ["X_CLIENT_ID", "X_CLIENT_SECRET", "APP_URL"]);
}

// X に払う月の上限（米ドル、矢書全体）。超えたら X の配信先は送らずに「要確認」にする（決定 D16）
export function xMonthlyBudgetUsd(): number {
  const raw = process.env.X_MONTHLY_BUDGET_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : X_DEFAULT_MONTHLY_BUDGET_USD;
}

// 利用者 1 人の、X の数字（投稿の数字とフォロワー数）の月の上限（米ドル）。超えたらその月は読まない
export function xMetricsUserMonthlyUsd(): number {
  const raw = process.env.X_METRICS_USER_MONTHLY_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : X_METRICS_DEFAULT_USER_MONTHLY_USD;
}

// 利用者 1 人の、X の投稿まわり（投稿・確認の読み取り・つなぐときの読み取り）の月の上限（米ドル）。超えたらその人の X だけ自動では送らない
export function xPostUserMonthlyUsd(): number {
  const raw = process.env.X_POST_USER_MONTHLY_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : X_POST_DEFAULT_USER_MONTHLY_USD;
}
