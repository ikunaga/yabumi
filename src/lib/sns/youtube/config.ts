import "server-only";
import { envReady } from "@/lib/env-check";
import { appUrl } from "@/lib/sns/threads/config";
import type { YouTubeConfig } from "./api";

// YouTube の連携（docs/design/youtube.md）。鍵は環境変数から読み、画面にもログにも出さない
export const YOUTUBE_PATHS = {
  connect: "/sns/youtube/connect",
  callback: "/sns/youtube/callback",
} as const;

export const YOUTUBE_STATE_COOKIE = "yabumi_youtube_oauth";

export function youtubeConfig(): YouTubeConfig {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("環境変数 YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET が設定されていません。");
  return { clientId, clientSecret, redirectUri: `${appUrl()}${YOUTUBE_PATHS.callback}` };
}

export function youtubeConfigured(): boolean {
  return envReady("YouTube の接続", ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "APP_URL"]);
}

// Google の同意の画面が「テスト中」か（許可が 7 日で切れる。docs/design/youtube.md の 2.2）。既定はテスト中（確認が済んだら false にする）
export function youtubeOAuthTesting(): boolean {
  return process.env.YOUTUBE_OAUTH_TESTING !== "false";
}

// アップロードの 1 日の上限（プロジェクト全体。Google の 100 本から、手での試しや余りの 10 本を引いた既定。監査で増えたら上げる）
export const YOUTUBE_USER_DAILY_UPLOADS = 5;
export function youtubeDailyUploads(): number {
  const n = Number(process.env.YOUTUBE_DAILY_UPLOADS);
  return Number.isInteger(n) && n > 0 ? n : 90;
}
