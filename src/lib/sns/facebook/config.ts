import "server-only";
import { envReady } from "@/lib/env-check";
import { appUrl } from "@/lib/sns/threads/config";
import type { FacebookConfig } from "./api";

export const FACEBOOK_PATHS = {
  connect: "/sns/facebook/connect",
  callback: "/sns/facebook/callback",
  uninstall: "/sns/facebook/uninstall",
  delete: "/sns/facebook/delete",
} as const;

export const FACEBOOK_STATE_COOKIE = "yabumi_facebook_oauth";

// Instagram・Facebook 用の Meta アプリの App ID・App secret と、Facebook Login for Business の設定の ID
export function facebookConfig(): FacebookConfig {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const configId = process.env.FACEBOOK_LOGIN_CONFIG_ID;
  if (!appId || !appSecret || !configId) {
    throw new Error("環境変数 META_APP_ID / META_APP_SECRET / FACEBOOK_LOGIN_CONFIG_ID が設定されていません。");
  }
  return { appId, appSecret, configId, redirectUri: `${appUrl()}${FACEBOOK_PATHS.callback}` };
}

export function facebookConfigured(): boolean {
  return envReady("Facebook ページの接続", ["META_APP_ID", "META_APP_SECRET", "FACEBOOK_LOGIN_CONFIG_ID", "APP_URL"]);
}

// 送るときに要るのはアプリシークレット（appsecret_proof）だけ
export function facebookAppSecret(): string {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("環境変数 META_APP_SECRET が設定されていません。");
  return secret;
}
