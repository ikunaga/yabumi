import "server-only";
import { envReady } from "@/lib/env-check";
import { appUrl } from "@/lib/sns/threads/config";
import type { XConfig } from "./api";
import { X_DEFAULT_MONTHLY_BUDGET_USD } from "./pricing";

export const X_PATHS = {
  connect: "/sns/x/connect",
  callback: "/sns/x/callback",
} as const;

// X の Developer Console の「Keys and tokens」にある OAuth 2.0 の Client ID と Client Secret
export function xConfig(): XConfig {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("環境変数 X_CLIENT_ID / X_CLIENT_SECRET が設定されていません。");
  }
  return { clientId, clientSecret, redirectUri: `${appUrl()}${X_PATHS.callback}` };
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
