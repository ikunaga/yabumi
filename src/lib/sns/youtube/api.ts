// YouTube（Google）の API（docs/design/youtube.md）。窓口の URL はここだけに置く。
// 出典は 2026-11-15 に読み直した公式の資料（OAuth 2.0 の Web サーバーの流れ、YouTube Data API v3 の videos.insert・再開できるアップロード・channels・videos）
import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

// 使うスコープはこの 2 つだけ（2026-11-15 オーナーの決定 Y1）。upload は送るため、readonly はチャンネル名と処理の状態を読むため
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_SCOPES = [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE] as const;

// 再開できるアップロードの 1 回の大きさ（256KB の倍数でなければならない。最後だけは例外）
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export type YouTubeConfig = { clientId: string; clientSecret: string; redirectUri: string };

export class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    // Google の errors[0].reason（例: quotaExceeded・uploadLimitExceeded）か、トークンの窓口の error（例: invalid_grant）。わからなければ空
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

// ===== PKCE（Google の OpenID の設定は S256 に対応と書いている。client_secret と併せて使う） =====
export function newCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizeUrl(config: YouTubeConfig, state: string, verifier: string): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // リフレッシュトークンをもらう。つなぎ直しでも必ず返るように、毎回同意の画面を出す
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function readError(res: Response): Promise<YouTubeApiError> {
  let reason = "";
  let message = `YouTube の API が ${res.status} を返しました`;
  try {
    const body = (await res.json()) as {
      error?: string | { message?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
    if (typeof body.error === "string") {
      reason = body.error;
      message = body.error_description ?? message;
    } else if (body.error) {
      reason = body.error.errors?.[0]?.reason ?? "";
      message = body.error.message ?? message;
    }
  } catch {
    // 本文が JSON でないときは、状態の番号だけで判断する
  }
  return new YouTubeApiError(res.status, reason, message);
}

async function callJson<T>(input: string, init: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// ===== トークン =====
export type YouTubeTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scopes: string[] };

export function readTokens(body: Record<string, unknown>, now: Date): YouTubeTokens {
  const accessToken = body.access_token;
  const expiresIn = Number(body.expires_in);
  if (typeof accessToken !== "string" || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new YouTubeApiError(200, "invalid_token_response", "Google のトークンの答えの形が違います");
  }
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [],
  };
}

async function tokenRequest(fields: Record<string, string>, now: Date): Promise<YouTubeTokens> {
  const body = await callJson<Record<string, unknown>>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return readTokens(body, now);
}

export function exchangeCode(config: YouTubeConfig, code: string, verifier: string, now = new Date()): Promise<YouTubeTokens> {
  return tokenRequest(
    { code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: verifier },
    now,
  );
}

// リフレッシュトークンは使い捨てではない（取り直しても同じものを使い続ける。答えに入っていなければ前のまま）
export function refreshTokens(config: YouTubeConfig, refreshToken: string, now = new Date()): Promise<YouTubeTokens> {
  return tokenRequest({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }, now);
}

// 取り消す（yabumi の「外す」・退会）。リフレッシュトークンを取り消すと、このプロジェクトに許したすべてのスコープが取り消される
export async function revokeToken(token: string): Promise<void> {
  const res = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw await readError(res);
}

// ===== チャンネル（youtube.readonly） =====
export type YouTubeChannel = { id: string; title: string; handle: string };

// 自分のチャンネル。チャンネルがない Google のアカウントは null
export async function fetchMyChannel(accessToken: string): Promise<YouTubeChannel | null> {
  const json = await callJson<{ items?: { id?: string; snippet?: { title?: string; customUrl?: string } }[] }>(
    `${YOUTUBE_API_URL}/channels?part=snippet&mine=true`,
    { headers: bearer(accessToken) },
  );
  const c = json.items?.[0];
  if (!c?.id) return null;
  return { id: c.id, title: (c.snippet?.title ?? "").slice(0, 100), handle: (c.snippet?.customUrl ?? "").replace(/^@/, "").slice(0, 100) };
}

// ===== 再開できるアップロード =====
export type VideoMetadata = {
  snippet: { title: string; description: string; categoryId: string; tags?: string[] };
  status: { privacyStatus: "public" | "unlisted" | "private"; selfDeclaredMadeForKids: boolean; containsSyntheticMedia: boolean };
};

// セッションを始める。答えの Location がセッションの URL
export async function startUploadSession(accessToken: string, meta: VideoMetadata, sizeBytes: number, mime: string): Promise<string> {
  const url = `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...bearer(accessToken),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(sizeBytes),
      "X-Upload-Content-Type": mime,
    },
    body: JSON.stringify(meta),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw await readError(res);
  const location = res.headers.get("location");
  if (!location || !location.startsWith("https://")) throw new YouTubeApiError(res.status, "no_session", "YouTube のアップロードのセッションが始まりませんでした");
  return location;
}

// 送った結果: 続き（受け取られたバイト数）か、完了（動画の ID）
export type UploadProgress = { done: false; received: number } | { done: true; videoId: string };

// 308 の Range（bytes=0-N）から、受け取られたバイト数（N+1）を読む。Range がなければ 0
export function receivedFromRange(range: string | null): number {
  const m = range ? /bytes=0-(\d+)/.exec(range) : null;
  return m ? Number(m[1]) + 1 : 0;
}

async function readProgress(res: Response): Promise<UploadProgress> {
  if (res.status === 308) return { done: false, received: receivedFromRange(res.headers.get("range")) };
  if (res.status === 200 || res.status === 201) {
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    if (typeof body.id !== "string" || !body.id) throw new YouTubeApiError(res.status, "no_video_id", "YouTube の答えに動画の ID がありません");
    return { done: true, videoId: body.id };
  }
  throw await readError(res);
}

// 1 回分（start〜start+bytes.length）を送る
export async function putChunk(sessionUri: string, accessToken: string, bytes: Uint8Array, start: number, total: number): Promise<UploadProgress> {
  const end = start + bytes.length - 1;
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { ...bearer(accessToken), "Content-Length": String(bytes.length), "Content-Range": `bytes ${start}-${end}/${total}` },
    body: bytes as BodyInit,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  return readProgress(res);
}

// どこまで受け取られたかを聞く（空の PUT）。404 はセッションが切れた
export async function queryUpload(sessionUri: string, accessToken: string, total: number): Promise<UploadProgress> {
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { ...bearer(accessToken), "Content-Length": "0", "Content-Range": `bytes */${total}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  return readProgress(res);
}

// ===== 送ったあとの処理の状態（youtube.readonly） =====
export type VideoProcessing = {
  uploadStatus: string;
  processingStatus: string;
  privacyStatus: string;
  rejectionReason: string;
  failureReason: string;
};

export async function fetchVideoProcessing(accessToken: string, videoId: string): Promise<VideoProcessing | null> {
  const json = await callJson<{
    items?: {
      status?: { uploadStatus?: string; privacyStatus?: string; rejectionReason?: string; failureReason?: string };
      processingDetails?: { processingStatus?: string };
    }[];
  }>(`${YOUTUBE_API_URL}/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, { headers: bearer(accessToken) });
  const v = json.items?.[0];
  if (!v) return null;
  return {
    uploadStatus: v.status?.uploadStatus ?? "",
    processingStatus: v.processingDetails?.processingStatus ?? "",
    privacyStatus: v.status?.privacyStatus ?? "",
    rejectionReason: v.status?.rejectionReason ?? "",
    failureReason: v.status?.failureReason ?? "",
  };
}

export const videoUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
