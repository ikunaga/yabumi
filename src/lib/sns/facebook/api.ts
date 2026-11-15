import { createHmac } from "node:crypto";

// Facebook ページへの投稿（Facebook Login for Business と Pages API。docs/architecture.md の 4.21）。
// 個人のプロフィールには API で投稿できない。投稿できるのはページだけ

export const FACEBOOK_GRAPH_URL = "https://graph.facebook.com";
// Graph API の版。版はおよそ 2 年使えるので、切れる前に上げる
export const FACEBOOK_API_VERSION = "v24.0";

// Facebook Login for Business の「設定（configuration）」に入れる権限。認可の URL には config_id を付ける
export const FACEBOOK_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"] as const;

// ページで投稿を作るのに要る役割（タスク）
export const REQUIRED_PAGE_TASK = "CREATE_CONTENT";

export type FacebookConfig = { appId: string; appSecret: string; configId: string; redirectUri: string };

export class FacebookApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // 190 はトークンが無効、4・17・32・613・80001 は回数制限、10・200 番台は権限がない
    readonly code?: number,
    readonly subcode?: number,
    readonly transient = false,
  ) {
    super(message);
    this.name = "FacebookApiError";
  }
}

export function authorizeUrl(config: FacebookConfig, state: string): string {
  const url = new URL(`https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("config_id", config.configId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("override_default_response_type", "true");
  return url.toString();
}

// トークンが盗まれても、アプリシークレットがなければ使えないようにする証明（appsecret_proof）。すべての呼び出しに付ける
export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

type GraphError = { message?: string; code?: number; error_subcode?: number; is_transient?: boolean };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new FacebookApiError(
      e.message ?? `Facebook API の呼び出しに失敗しました（${res.status}）`,
      res.status,
      e.code,
      e.error_subcode,
      Boolean(e.is_transient) || res.status >= 500,
    );
  }
  return json;
}

function graph(path: string, token: string | null, appSecret: string, params: Record<string, string> = {}): string {
  const url = new URL(`${FACEBOOK_GRAPH_URL}/${FACEBOOK_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (token) {
    url.searchParams.set("access_token", token);
    url.searchParams.set("appsecret_proof", appSecretProof(token, appSecret));
  }
  return url.toString();
}

// ===== トークン =====
// 認可コード → ユーザーの短期トークン
export async function exchangeCode(config: FacebookConfig, code: string): Promise<string> {
  const json = await call<{ access_token: string }>(
    graph("oauth/access_token", null, config.appSecret, {
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      code,
    }),
  );
  return json.access_token;
}

// ユーザーの短期トークン → 長期トークン（60 日）。ここから取ったページのトークンは期限がない
export async function exchangeForLongLived(config: FacebookConfig, shortToken: string): Promise<string> {
  const json = await call<{ access_token: string }>(
    graph("oauth/access_token", null, config.appSecret, {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: shortToken,
    }),
  );
  return json.access_token;
}

export async function fetchUserId(config: FacebookConfig, userToken: string): Promise<string> {
  const json = await call<{ id: string }>(graph("me", userToken, config.appSecret, { fields: "id" }));
  return String(json.id);
}

export type ManagedPage = { id: string; name: string; accessToken: string; canPost: boolean };

// 利用者が管理しているページと、ページのトークン。投稿を作れる役割（CREATE_CONTENT）がないページは canPost が false
export async function listPages(config: FacebookConfig, userToken: string): Promise<ManagedPage[]> {
  type Row = { id: string; name: string; access_token: string; tasks?: string[] };
  const pages: ManagedPage[] = [];
  let next: string | null = graph("me/accounts", userToken, config.appSecret, { fields: "id,name,access_token,tasks", limit: "100" });
  // ページが多い人のために、次のページを順にたどる（10 回まで）
  for (let i = 0; next && i < 10; i++) {
    const json: { data: Row[]; paging?: { next?: string } } = await call(next);
    for (const p of json.data) {
      pages.push({ id: String(p.id), name: p.name, accessToken: p.access_token, canPost: (p.tasks ?? []).includes(REQUIRED_PAGE_TASK) });
    }
    next = json.paging?.next ?? null;
  }
  return pages;
}

// ===== 投稿 =====
function form(params: Record<string, string>): RequestInit {
  return { method: "POST", body: new URLSearchParams(params) };
}

// 文章だけ（リンクは本文の中の URL から Facebook がカードを作る）
export async function postText(appSecret: string, pageToken: string, pageId: string, message: string): Promise<string> {
  const json = await call<{ id: string }>(graph(`${pageId}/feed`, pageToken, appSecret), form({ message }));
  return String(json.id);
}

// 画像 1 枚。投稿の ID（post_id）を返す
export async function postPhoto(appSecret: string, pageToken: string, pageId: string, imageUrl: string, message: string): Promise<string> {
  const json = await call<{ id: string; post_id?: string }>(
    graph(`${pageId}/photos`, pageToken, appSecret),
    form({ url: imageUrl, message, published: "true" }),
  );
  return String(json.post_id ?? json.id);
}

// 画像を公開せずに上げる（複数枚の投稿の材料）
export async function uploadUnpublishedPhoto(appSecret: string, pageToken: string, pageId: string, imageUrl: string): Promise<string> {
  const json = await call<{ id: string }>(graph(`${pageId}/photos`, pageToken, appSecret), form({ url: imageUrl, published: "false" }));
  return String(json.id);
}

// 公開せずに上げた画像を並べて、1 つの投稿にする
export async function postWithPhotos(appSecret: string, pageToken: string, pageId: string, photoIds: string[], message: string): Promise<string> {
  const params: Record<string, string> = { message };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const json = await call<{ id: string }>(graph(`${pageId}/feed`, pageToken, appSecret), form(params));
  return String(json.id);
}

// ===== リール（動画 1 本。docs/design/video.md の 5.。公式の Reels Publishing API の 3 段階） =====
// 1. 受付（upload_phase=start）→ 2. Facebook に動画を取りに来てもらう（rupload に file_url）→ 3. 公開（upload_phase=finish）。
// 公開は Facebook の処理が終わってから行われるので、状態（status）で確かめる

export const FACEBOOK_RUPLOAD_URL = "https://rupload.facebook.com";

export async function startReelUpload(appSecret: string, pageToken: string, pageId: string): Promise<string> {
  const json = await call<{ video_id: string }>(graph(`${pageId}/video_reels`, pageToken, appSecret), form({ upload_phase: "start" }));
  return String(json.video_id);
}

// Facebook に、署名 URL の動画を取りに来てもらう（こちらからは送らない）。
// rupload は access_token の代わりに Authorization: OAuth を使う。appsecret_proof を求められるかは資料に書かれていない【未確認】
export async function uploadReelFromUrl(pageToken: string, videoId: string, fileUrl: string): Promise<void> {
  await call<{ success: boolean }>(`${FACEBOOK_RUPLOAD_URL}/video-upload/${FACEBOOK_API_VERSION}/${videoId}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${pageToken}`, file_url: fileUrl },
  });
}

export type ReelPhase = "not_started" | "in_progress" | "complete" | "error" | string;
export type ReelStatus = { videoStatus: string; uploading: ReelPhase; processing: ReelPhase; publishing: ReelPhase; error?: string };

export async function getReelStatus(appSecret: string, pageToken: string, videoId: string): Promise<ReelStatus> {
  type Phase = { status?: string; errors?: { message?: string }[] };
  const json = await call<{ status?: { video_status?: string; uploading_phase?: Phase; processing_phase?: Phase; publishing_phase?: Phase } }>(
    graph(videoId, pageToken, appSecret, { fields: "status" }),
  );
  const st = json.status ?? {};
  const phases = [st.uploading_phase, st.processing_phase, st.publishing_phase];
  const error = phases.flatMap((p) => p?.errors ?? []).map((e) => e.message).find(Boolean);
  return {
    videoStatus: st.video_status ?? "",
    uploading: st.uploading_phase?.status ?? "not_started",
    processing: st.processing_phase?.status ?? "not_started",
    publishing: st.publishing_phase?.status ?? "not_started",
    ...(error ? { error } : {}),
  };
}

export async function finishReel(appSecret: string, pageToken: string, pageId: string, videoId: string, description: string): Promise<void> {
  await call<{ success: boolean }>(
    graph(`${pageId}/video_reels`, pageToken, appSecret),
    form({ upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description }),
  );
}

export async function getPermalink(appSecret: string, pageToken: string, postId: string): Promise<string | null> {
  const json = await call<{ permalink_url?: string }>(graph(postId, pageToken, appSecret, { fields: "permalink_url" }));
  return json.permalink_url ?? null;
}

// 投稿を消す（yabumi が投稿したものだけ消せる）
export async function deletePost(appSecret: string, pageToken: string, postId: string): Promise<void> {
  await call<{ success: boolean }>(graph(postId, pageToken, appSecret), { method: "DELETE" });
}
