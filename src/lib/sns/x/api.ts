import { createHash, randomBytes } from "node:crypto";

// X API v2 の OAuth 2.0（Authorization Code + PKCE）と投稿（docs/architecture.md の 4.13）。
// X の API は使った分だけ払う方式（投稿 1 本 $0.015、URL があると $0.20）。費用の記録と上限は publisher.ts と x/spend.ts

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_API_URL = "https://api.x.com";

// offline.access がないとリフレッシュトークンが出ず、2 時間でつなぎ直しになる。
// 画像を付けるとき（フェーズ 5）は media.write を足し、つないだ済みの人には「つなぎ直す」をしてもらう
export const X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"] as const;

export type XConfig = { clientId: string; clientSecret: string; redirectUri: string };

export class XApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // OAuth のエラー（invalid_grant など）や、API の problem の type の末尾（UsageCapExceeded など）
    readonly code?: string,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

// ===== PKCE =====
export function newCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizeUrl(config: XConfig, state: string, verifier: string): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type ErrorBody = {
  error?: string;
  error_description?: string;
  title?: string;
  detail?: string;
  type?: string;
  errors?: { message?: string; title?: string; detail?: string; type?: string }[];
};

function lastPart(type: string | undefined): string | undefined {
  return type ? type.split("/").pop() : undefined;
}

async function call<T>(input: string, init: RequestInit): Promise<T> {
  // 応答が来ないまま待ち続けると、トークンの延長の権利（30 秒）が切れて二重の延長になりうるので、20 秒で打ち切る
  const res = await fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) {
    // 応答にトークンが含まれることはないが、念のためメッセージだけを残す
    const first = json.errors?.[0];
    const message = json.error_description ?? json.detail ?? first?.detail ?? first?.message ?? json.title ?? `X API の呼び出しに失敗しました（${res.status}）`;
    throw new XApiError(message, res.status, json.error ?? lastPart(json.type) ?? lastPart(first?.type) ?? first?.title);
  }
  return json;
}

// ===== トークン =====
export type XTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string[] };

function basicAuth(config: XConfig): string {
  return `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

function toTokens(json: TokenResponse, now: Date): XTokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(now.getTime() + json.expires_in * 1000),
    scopes: json.scope ? json.scope.split(" ") : [...X_SCOPES],
  };
}

async function tokenRequest(config: XConfig, params: Record<string, string>, now: Date): Promise<XTokens> {
  const json = await call<TokenResponse>(`${X_API_URL}/2/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(config), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return toTokens(json, now);
}

// 認可コード → アクセストークン（2 時間）とリフレッシュトークン
export function exchangeCode(config: XConfig, code: string, verifier: string, now = new Date()): Promise<XTokens> {
  return tokenRequest(config, { grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: verifier }, now);
}

// リフレッシュトークンでアクセストークンを取り直す。リフレッシュトークンは使い捨てで、新しいものが返る（古いものは使えなくなる）
export function refreshTokens(config: XConfig, refreshToken: string, now = new Date()): Promise<XTokens> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, now);
}

// トークンを X 側で取り消す（SNS を外す・退会のとき）。リフレッシュトークンを取り消すと、そこから出たアクセストークンも使えなくなる
export async function revokeToken(config: XConfig, token: string, hint: "access_token" | "refresh_token"): Promise<void> {
  await call<{ revoked?: boolean }>(`${X_API_URL}/2/oauth2/revoke`, {
    method: "POST",
    headers: { Authorization: basicAuth(config), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, token_type_hint: hint }),
  });
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ===== ユーザー（$0.010。つなぐときに 1 回だけ） =====
export type XProfile = { id: string; username: string; name: string };

export async function fetchMe(token: string): Promise<XProfile> {
  const json = await call<{ data: { id: string; username: string; name: string } }>(`${X_API_URL}/2/users/me`, {
    method: "GET",
    headers: bearer(token),
  });
  return { id: String(json.data.id), username: json.data.username ?? "", name: json.data.name ?? "" };
}

// ===== 投稿（$0.015、URL があると $0.20）と削除（無料） =====
export async function createPost(token: string, text: string): Promise<{ id: string }> {
  const json = await call<{ data: { id: string } }>(`${X_API_URL}/2/tweets`, {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { id: String(json.data.id) };
}

export async function deletePost(token: string, postId: string): Promise<void> {
  await call<{ data: { deleted: boolean } }>(`${X_API_URL}/2/tweets/${encodeURIComponent(postId)}`, {
    method: "DELETE",
    headers: bearer(token),
  });
}

// ユーザー名がなくても開ける投稿の URL
export function postUrl(postId: string): string {
  return `https://x.com/i/web/status/${postId}`;
}
