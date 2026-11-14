import "server-only";
import { envReady } from "@/lib/env-check";
import { appUrl } from "@/lib/sns/threads/config";
import type { TikTokConfig } from "./api";

// TikTok の連携（docs/design/tiktok.md）。鍵は環境変数から読み、画面にもログにも出さない
export const TIKTOK_PATHS = {
  connect: "/sns/tiktok/connect",
  callback: "/sns/tiktok/callback",
  webhook: "/sns/tiktok/webhook",
  // 写真を渡す入口（https://yabumi.app/tiktok-media/<トークン>.jpg。TikTok には「URL の前半」で登録する）
  media: "/tiktok-media",
} as const;

export function tiktokConfig(): TikTokConfig {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) throw new Error("環境変数 TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET が設定されていません。");
  return { clientKey, clientSecret, redirectUri: `${appUrl()}${TIKTOK_PATHS.callback}` };
}

export function tiktokConfigured(): boolean {
  return envReady("TikTok の接続", ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "APP_URL"]);
}

// TikTok の審査（監査）が済んだか。済むまでは「自分だけ」の投稿しかできない（docs/design/tiktok.md の 9.）。既定は済んでいない
export function tiktokAudited(): boolean {
  return process.env.TIKTOK_AUDITED === "true";
}
