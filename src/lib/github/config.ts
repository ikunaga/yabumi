import "server-only";
import { envReady } from "@/lib/env-check";
import { appUrl } from "@/lib/sns/threads/config";

// GitHub App の設定（docs/architecture.md の 4.10）。秘密鍵とクライアントシークレットはサーバーの環境変数だけに置く
export type GitHubAppConfig = { appId: string; slug: string; clientId: string; clientSecret: string; privateKey: string };

export const GITHUB_PATHS = { install: "/github/install", callback: "/github/callback" } as const;
export const GITHUB_STATE_COOKIE = "yabumi_github_oauth";

const GITHUB_ENV = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "APP_URL"] as const;

export function githubConfigured(): boolean {
  return envReady("GitHub との連携", GITHUB_ENV);
}

export function githubConfig(): GitHubAppConfig {
  if (!githubConfigured()) throw new Error("環境変数 GITHUB_APP_* が設定されていません。");
  const e = process.env;
  return { appId: e.GITHUB_APP_ID!, slug: e.GITHUB_APP_SLUG!, clientId: e.GITHUB_APP_CLIENT_ID!, clientSecret: e.GITHUB_APP_CLIENT_SECRET!, privateKey: e.GITHUB_APP_PRIVATE_KEY! };
}

// インストールの画面（読ませるリポジトリを選ぶ）。インストール済みなら、設定を変える画面になる
export function installUrl(cfg: GitHubAppConfig, state: string): string {
  const url = new URL(`https://github.com/apps/${cfg.slug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

// 利用者の認可（インストールが本人のものかを確かめるため）
export function authorizeUrl(cfg: GitHubAppConfig, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", `${appUrl()}${GITHUB_PATHS.callback}`);
  url.searchParams.set("state", state);
  return url.toString();
}
