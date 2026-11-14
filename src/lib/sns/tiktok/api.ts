// TikTok の API（docs/design/tiktok.md）。窓口の URL はここだけに置く。
// トークンの取得・取り直し・取り消し、ユーザー情報の窓口は、2026-11-14 に PM が公式の資料で確かめた
// （doc/oauth-get-a-user-access-token・oauth-user-access-token-management・oauth-revoke・user info）。
// トークンの期限（いまの資料ではアクセス 2 時間・リフレッシュ 180 日）は決め打ちにせず、返ってきた expires_in・refresh_expires_in を使う
export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_URL = "https://open.tiktokapis.com";
export const TIKTOK_TOKEN_PATH = "/v2/oauth/token/";
export const TIKTOK_REVOKE_PATH = "/v2/oauth/revoke/";
// user.info.basic で読める項目（open_id・union_id・avatar_url・avatar_url_100・avatar_large_url・display_name）。username は user.info.profile なので読まず、creator_info から読む。
// 資料に「この API は移行の予定がある」と注意書きがある（2026-11-14）
export const TIKTOK_USER_INFO_PATH = "/v2/user/info/?fields=open_id,avatar_url,display_name";
export const TIKTOK_CREATOR_INFO_PATH = "/v2/post/publish/creator_info/query/";

// 使うスコープはこの 3 つだけ（docs/design/tiktok.md の 1.）
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"] as const;

export type TikTokConfig = { clientKey: string; clientSecret: string; redirectUri: string };

export class TikTokApiError extends Error {
  constructor(
    readonly status: number,
    // TikTok の error.code（例: access_token_invalid、spam_risk_too_many_posts）。わからなければ空
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TikTokApiError";
  }
}

export function authorizeUrl(config: TikTokConfig, state: string): string {
  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${TIKTOK_API_URL}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 本文が JSON でないときは、状態の番号だけで判断する
  }
  // 返り方は 2 つある: トークンの窓口は { error, error_description } を、そのほかは { data, error: { code, message } } を返す
  const err = body.error;
  const code = typeof err === "string" ? err : err && typeof err === "object" ? String((err as { code?: unknown }).code ?? "") : "";
  if (!res.ok || (code && code !== "ok")) {
    const message = typeof body.error_description === "string" ? body.error_description : err && typeof err === "object" ? String((err as { message?: unknown }).message ?? "") : "";
    throw new TikTokApiError(res.status, code, message || `TikTok の API が ${res.status} を返しました`);
  }
  return body;
}

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

export type TikTokTokens = { accessToken: string; refreshToken: string; expiresAt: Date; refreshExpiresAt: Date | null; openId: string; scopes: string[] };

// トークンの答えを読む。期限は返ってきた秒数から決める（決め打ちにしない）
export function readTokens(body: Record<string, unknown>, now: Date): TikTokTokens {
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  const expiresIn = Number(body.expires_in);
  if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new TikTokApiError(200, "invalid_token_response", "TikTok のトークンの答えの形が違います");
  }
  const refreshIn = Number(body.refresh_expires_in);
  const scopes = typeof body.scope === "string" ? body.scope.split(/[,\s]+/).filter(Boolean) : [];
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    refreshExpiresAt: Number.isFinite(refreshIn) && refreshIn > 0 ? new Date(now.getTime() + refreshIn * 1000) : null,
    openId: typeof body.open_id === "string" ? body.open_id : "",
    scopes,
  };
}

export async function exchangeCode(config: TikTokConfig, code: string, now = new Date()): Promise<TikTokTokens> {
  const body = await call(TIKTOK_TOKEN_PATH, form({ client_key: config.clientKey, client_secret: config.clientSecret, code, grant_type: "authorization_code", redirect_uri: config.redirectUri }));
  return readTokens(body, now);
}

// リフレッシュトークンは使い捨て（新しいものが返る）。古いものを使うと以後の取り直しができなくなるので、必ず入れ替える
export async function refreshTokens(config: TikTokConfig, refreshToken: string, now = new Date()): Promise<TikTokTokens> {
  const body = await call(TIKTOK_TOKEN_PATH, form({ client_key: config.clientKey, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }));
  return readTokens(body, now);
}

export async function revokeToken(config: TikTokConfig, accessToken: string): Promise<void> {
  await call(TIKTOK_REVOKE_PATH, form({ client_key: config.clientKey, client_secret: config.clientSecret, token: accessToken }));
}

export type TikTokUser = { openId: string; displayName: string; avatarUrl: string | null };

export async function fetchUser(accessToken: string): Promise<TikTokUser> {
  const body = await call(TIKTOK_USER_INFO_PATH, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  const user = ((body.data as { user?: Record<string, unknown> } | undefined)?.user ?? {}) as Record<string, unknown>;
  return {
    openId: typeof user.open_id === "string" ? user.open_id : "",
    displayName: typeof user.display_name === "string" ? user.display_name : "",
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
  };
}

// 投稿するアカウントの、いまの状態（docs/design/tiktok.md の 3. と 4.）。アイコンの URL は 2 時間で切れるので保存しない
export type CreatorInfo = {
  username: string;
  nickname: string;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
};

// 投稿できない状態の理由（creator_info・投稿の窓口が返す）。この理由のときは送らない
export const CANNOT_POST_CODES = ["spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap"] as const;

export async function fetchCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const body = await call(TIKTOK_CREATOR_INFO_PATH, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" } });
  const d = (body.data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    username: str(d.creator_username),
    nickname: str(d.creator_nickname),
    avatarUrl: typeof d.creator_avatar_url === "string" ? d.creator_avatar_url : null,
    privacyLevelOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.filter((x): x is string => typeof x === "string") : [],
    commentDisabled: d.comment_disabled === true,
    duetDisabled: d.duet_disabled === true,
    stitchDisabled: d.stitch_disabled === true,
    maxVideoPostDurationSec: typeof d.max_video_post_duration_sec === "number" ? d.max_video_post_duration_sec : null,
  };
}

// つないだアカウントの名前（ニックネームと @ の名前）。@ の名前は creator_info（video.publish）でしか読めないので、
// video.publish を許可していないときは、ユーザー情報（user.info.basic）の表示名だけにする
export async function connectedProfile(tokens: TikTokTokens): Promise<{ openId: string; nickname: string; username: string }> {
  if (tokens.scopes.includes("video.publish")) {
    try {
      const c = await fetchCreatorInfo(tokens.accessToken);
      if (c.nickname || c.username) return { openId: tokens.openId, nickname: c.nickname, username: c.username };
    } catch {
      // 投稿できない状態でも、つなぐのは続ける（名前はユーザー情報から）
    }
  }
  const u = await fetchUser(tokens.accessToken);
  return { openId: tokens.openId || u.openId, nickname: u.displayName, username: "" };
}

export const TIKTOK_CONTENT_INIT_PATH = "/v2/post/publish/content/init/";
export const TIKTOK_STATUS_PATH = "/v2/post/publish/status/fetch/";

// 写真の投稿を始める（直接投稿か下書き）。答えは publish_id（状態は status/fetch で確かめる）。トークン 1 つで 1 分 6 回まで
export async function initPhotoPost(accessToken: string, body: Record<string, unknown>): Promise<string> {
  const res = await call(TIKTOK_CONTENT_INIT_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const id = (res.data as { publish_id?: unknown } | undefined)?.publish_id;
  if (typeof id !== "string" || !id) throw new TikTokApiError(200, "invalid_publish_response", "TikTok の投稿の答えに publish_id がありません");
  return id;
}

export type PublishStatus = { status: string; failReason: string; postIds: string[] };

// 投稿の状態（トークン 1 つで 1 分 30 回まで）。publicaly_available_post_id は資料の綴りのまま
export async function fetchPublishStatus(accessToken: string, publishId: string): Promise<PublishStatus> {
  const res = await call(TIKTOK_STATUS_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const d = (res.data ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id.map((x) => String(x)) : [];
  return { status: typeof d.status === "string" ? d.status : "", failReason: typeof d.fail_reason === "string" ? d.fail_reason : "", postIds: ids };
}
