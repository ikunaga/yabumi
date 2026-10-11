import "server-only";
import { envReady } from "@/lib/env-check";
import { appUrl } from "@/lib/sns/threads/config";
import type { InstagramConfig } from "./api";

export const INSTAGRAM_PATHS = {
  connect: "/sns/instagram/connect",
  callback: "/sns/instagram/callback",
  uninstall: "/sns/instagram/uninstall",
  delete: "/sns/instagram/delete",
} as const;

export const INSTAGRAM_STATE_COOKIE = "yabumi_instagram_oauth";

// Instagram・Facebook 用の Meta アプリの、Instagram のユースケースの画面にある「Instagram app ID / secret」
export function instagramConfig(): InstagramConfig {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error("環境変数 INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET が設定されていません。");
  return { appId, appSecret, redirectUri: `${appUrl()}${INSTAGRAM_PATHS.callback}` };
}

export function instagramConfigured(): boolean {
  return envReady("Instagram の接続", ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "APP_URL"]);
}
