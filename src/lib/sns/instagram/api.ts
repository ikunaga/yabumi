// Instagram API with Instagram Login（Business Login for Instagram）の OAuth・トークン・投稿（docs/architecture.md の 4.21）。
// Instagram・Facebook 用の Meta アプリの「Instagram app ID / secret」を使う（Meta の App ID とは別の値）
import { withInsightsScope } from "@/lib/sns/insights/scopes";

export const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
// Graph API の版。版はおよそ 2 年使えるので、切れる前に上げる
export const INSTAGRAM_API_VERSION = "v24.0";

// 求める権限。指標（instagram_business_manage_insights）は使うときに足す（使わない権限は審査で却下の理由になる）
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;

// プロアカウント（ビジネス・クリエイター）だけが API を使える
export const PROFESSIONAL_ACCOUNT_TYPES = new Set(["BUSINESS", "MEDIA_CREATOR", "CREATOR"]);

export type InstagramConfig = { appId: string; appSecret: string; redirectUri: string };

export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // Graph API のエラーコード。190 はトークンが無効、4・17・32・613 は回数制限
    readonly code?: number,
    readonly subcode?: number,
    readonly transient = false,
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

export function authorizeUrl(config: InstagramConfig, state: string): string {
  const url = new URL(INSTAGRAM_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  // 数字の権限（instagram_business_manage_insights）は、SNS_INSIGHTS で有効にしたときだけ求める（4.22）
  url.searchParams.set("scope", withInsightsScope("instagram", INSTAGRAM_SCOPES).join(","));
  url.searchParams.set("state", state);
  // 前にほかのアカウントで許可していても、つなぐアカウントを選び直せるようにする
  url.searchParams.set("force_reauth", "true");
  return url.toString();
}

type GraphError = { message?: string; code?: number; error_subcode?: number; is_transient?: boolean };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: GraphError | string; error_message?: string; error_type?: string };
  if (!res.ok || json.error) {
    // トークンの交換のエラーは { error_type, code, error_message } の形で来ることがある
    const e = typeof json.error === "object" && json.error ? json.error : {};
    const message = e.message ?? json.error_message ?? (typeof json.error === "string" ? json.error : undefined) ?? `Instagram API の呼び出しに失敗しました（${res.status}）`;
    throw new InstagramApiError(message, res.status, e.code, e.error_subcode, Boolean(e.is_transient) || res.status >= 500);
  }
  return json;
}

function graph(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function form(params: Record<string, string>): RequestInit {
  return { method: "POST", body: new URLSearchParams(params) };
}

// ===== トークン =====
// 認可コード → 短期トークン（1 時間）。コードの末尾に付く "#_" は取り除く。
// 応答は { access_token, user_id } か、{ data: [{ access_token, user_id }] } の形で来る
export async function exchangeCode(config: InstagramConfig, code: string): Promise<{ accessToken: string; userId: string }> {
  type Short = { access_token: string; user_id: string | number };
  const json = await call<Short & { data?: Short[] }>(
    INSTAGRAM_TOKEN_URL,
    form({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code: code.replace(/#_$/, ""),
    }),
  );
  const t = json.data?.[0] ?? json;
  return { accessToken: t.access_token, userId: String(t.user_id) };
}

export type LongLivedToken = { accessToken: string; expiresAt: Date };

function toLongLived(json: { access_token: string; expires_in: number }, now: Date): LongLivedToken {
  return { accessToken: json.access_token, expiresAt: new Date(now.getTime() + json.expires_in * 1000) };
}

// 短期トークン → 長期トークン（60 日）
export async function exchangeForLongLived(config: InstagramConfig, shortToken: string, now = new Date()): Promise<LongLivedToken> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("access_token", shortToken);
  return toLongLived(await call(url.toString()), now);
}

// 長期トークンの延長。発行から 24 時間以上たち、まだ切れていないものだけが延長できる（延長後また 60 日）
export async function refreshLongLived(token: string, now = new Date()): Promise<LongLivedToken> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  return toLongLived(await call(url.toString()), now);
}

export type InstagramProfile = { id: string; username: string; name: string; accountType: string };

export async function fetchProfile(token: string): Promise<InstagramProfile> {
  const json = await call<{ user_id?: string | number; id?: string; username?: string; name?: string; account_type?: string }>(
    graph("me", { fields: "user_id,username,name,account_type", access_token: token }),
  );
  return { id: String(json.user_id ?? json.id), username: json.username ?? "", name: json.name ?? "", accountType: json.account_type ?? "" };
}

// ===== 投稿（コンテナを作る → 準備を待つ → 公開） =====
export async function createImageContainer(
  token: string,
  igUserId: string,
  imageUrl: string,
  opts: { caption?: string; altText?: string; carouselItem?: boolean } = {},
): Promise<string> {
  const params: Record<string, string> = { image_url: imageUrl, access_token: token };
  if (opts.carouselItem) params.is_carousel_item = "true";
  if (opts.caption) params.caption = opts.caption;
  if (opts.altText) params.alt_text = opts.altText;
  const json = await call<{ id: string }>(graph(`${igUserId}/media`), form(params));
  return String(json.id);
}

export async function createCarouselContainer(token: string, igUserId: string, children: string[], caption: string): Promise<string> {
  const json = await call<{ id: string }>(
    graph(`${igUserId}/media`),
    form({ media_type: "CAROUSEL", children: children.join(","), caption, access_token: token }),
  );
  return String(json.id);
}

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export async function getContainerStatus(token: string, containerId: string): Promise<{ status: ContainerStatus; detail?: string }> {
  const json = await call<{ status_code: ContainerStatus; status?: string }>(graph(containerId, { fields: "status_code,status", access_token: token }));
  return { status: json.status_code, detail: json.status };
}

export async function publishContainer(token: string, igUserId: string, containerId: string): Promise<string> {
  const json = await call<{ id: string }>(graph(`${igUserId}/media_publish`), form({ creation_id: containerId, access_token: token }));
  return String(json.id);
}

export async function getPermalink(token: string, mediaId: string): Promise<string | null> {
  const json = await call<{ permalink?: string }>(graph(mediaId, { fields: "permalink", access_token: token }));
  return json.permalink ?? null;
}

// 延長する時期かどうか。Threads と同じく、期限まで 30 日を切ったら延長する
export const REFRESH_BEFORE_DAYS = 30;

export function shouldRefresh(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < REFRESH_BEFORE_DAYS * 24 * 60 * 60 * 1000;
}
