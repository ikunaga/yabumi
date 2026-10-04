import "server-only";
import { envReady } from "@/lib/env-check";
import type { ThreadsConfig } from "./api";

// アプリの公開 URL。Threads のコールバック URL は https が必須なので、ローカルでも https://localhost:3100 を使う
export function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("環境変数 APP_URL が設定されていません。.env.example を参考に .env.local に追加してください。");
  return url.replace(/\/$/, "");
}

export const THREADS_PATHS = {
  connect: "/sns/threads/connect",
  callback: "/sns/threads/callback",
  uninstall: "/sns/threads/uninstall",
  delete: "/sns/threads/delete",
  deletionStatus: "/sns/threads/deletion",
} as const;

export function threadsConfig(): ThreadsConfig {
  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("環境変数 THREADS_APP_ID / THREADS_APP_SECRET が設定されていません。");
  }
  return { appId, appSecret, redirectUri: `${appUrl()}${THREADS_PATHS.callback}` };
}

export function threadsConfigured(): boolean {
  return envReady("Threads の接続", ["THREADS_APP_ID", "THREADS_APP_SECRET", "APP_URL"]);
}
