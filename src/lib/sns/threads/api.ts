// Threads API の OAuth とトークン（https://developers.facebook.com/docs/threads/get-started）
// Threads は Instagram・Facebook とは別の Meta アプリ（THREADS_APP_ID / THREADS_APP_SECRET）を使う。

export const THREADS_AUTHORIZE_URL = "https://threads.com/oauth/authorize";
export const THREADS_GRAPH_URL = "https://graph.threads.com";

// 求める権限。Meta アプリ側で追加していない権限を入れると認可画面がエラーになる。
// 権限を足したら、つないだ済みのアカウントは「つなぎ直す」で新しい権限が入る
export const THREADS_SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_delete"] as const;

export type ThreadsConfig = { appId: string; appSecret: string; redirectUri: string };

export class ThreadsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // Graph API のエラーコード。190 はトークンが無効、4・17・32・613 は回数制限
    readonly code?: number,
    readonly transient = false,
  ) {
    super(message);
    this.name = "ThreadsApiError";
  }
}

export function authorizeUrl(config: ThreadsConfig, state: string): string {
  const url = new URL(THREADS_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", THREADS_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

type GraphError = { message?: string; code?: number; is_transient?: boolean };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  if (!res.ok || json.error) {
    // 応答にトークンが含まれることはないが、念のためメッセージだけを残す
    const e = json.error ?? {};
    throw new ThreadsApiError(
      e.message ?? `Threads API の呼び出しに失敗しました（${res.status}）`,
      res.status,
      e.code,
      Boolean(e.is_transient) || res.status >= 500,
    );
  }
  return json;
}

// 認可コード → 短期トークン（1 時間）。コードの末尾に付く "#_" は取り除く
export async function exchangeCode(config: ThreadsConfig, code: string): Promise<{ accessToken: string; userId: string }> {
  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code: code.replace(/#_$/, ""),
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  const json = await call<{ access_token: string; user_id: string | number }>(`${THREADS_GRAPH_URL}/oauth/access_token`, {
    method: "POST",
    body,
  });
  return { accessToken: json.access_token, userId: String(json.user_id) };
}

export type LongLivedToken = { accessToken: string; expiresAt: Date };

function toLongLived(json: { access_token: string; expires_in: number }, now: Date): LongLivedToken {
  return { accessToken: json.access_token, expiresAt: new Date(now.getTime() + json.expires_in * 1000) };
}

// 短期トークン → 長期トークン（60 日）
export async function exchangeForLongLived(config: ThreadsConfig, shortToken: string, now = new Date()): Promise<LongLivedToken> {
  const url = new URL(`${THREADS_GRAPH_URL}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("access_token", shortToken);
  return toLongLived(await call(url.toString()), now);
}

// 長期トークンの延長。発行から 24 時間以上たち、まだ切れていないものだけが延長できる（延長後また 60 日）
export async function refreshLongLived(token: string, now = new Date()): Promise<LongLivedToken> {
  const url = new URL(`${THREADS_GRAPH_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", token);
  return toLongLived(await call(url.toString()), now);
}

export type ThreadsProfile = { id: string; username: string; name: string };

export async function fetchProfile(token: string): Promise<ThreadsProfile> {
  const url = new URL(`${THREADS_GRAPH_URL}/v1.0/me`);
  url.searchParams.set("fields", "id,username,name");
  url.searchParams.set("access_token", token);
  const json = await call<{ id: string; username?: string; name?: string }>(url.toString());
  return { id: String(json.id), username: json.username ?? "", name: json.name ?? "" };
}

// 延長する時期かどうか。期限まで REFRESH_BEFORE_DAYS 日を切ったら延長する（日次のジョブから呼ぶ想定）
export const REFRESH_BEFORE_DAYS = 30;

export function shouldRefresh(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < REFRESH_BEFORE_DAYS * 24 * 60 * 60 * 1000;
}

// ===== 投稿（https://developers.facebook.com/docs/threads/posts） =====
// 文章の投稿は「コンテナを作る → 公開する」の 2 段階

function form(params: Record<string, string>) {
  return { method: "POST", body: new URLSearchParams(params) } satisfies RequestInit;
}

export async function createTextContainer(token: string, text: string): Promise<string> {
  const json = await call<{ id: string }>(
    `${THREADS_GRAPH_URL}/v1.0/me/threads`,
    form({ media_type: "TEXT", text, access_token: token }),
  );
  return String(json.id);
}

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export async function getContainerStatus(token: string, containerId: string): Promise<{ status: ContainerStatus; errorMessage?: string }> {
  const url = new URL(`${THREADS_GRAPH_URL}/v1.0/${containerId}`);
  url.searchParams.set("fields", "status,error_message");
  url.searchParams.set("access_token", token);
  const json = await call<{ status: ContainerStatus; error_message?: string }>(url.toString());
  return { status: json.status, errorMessage: json.error_message };
}

export async function publishContainer(token: string, containerId: string): Promise<string> {
  const json = await call<{ id: string }>(
    `${THREADS_GRAPH_URL}/v1.0/me/threads_publish`,
    form({ creation_id: containerId, access_token: token }),
  );
  return String(json.id);
}

export async function getPermalink(token: string, mediaId: string): Promise<string | null> {
  const url = new URL(`${THREADS_GRAPH_URL}/v1.0/${mediaId}`);
  url.searchParams.set("fields", "permalink");
  url.searchParams.set("access_token", token);
  const json = await call<{ permalink?: string }>(url.toString());
  return json.permalink ?? null;
}

// 投稿の削除（threads_delete が必要。1 日 100 件まで）
export async function deleteMedia(token: string, mediaId: string): Promise<void> {
  const url = new URL(`${THREADS_GRAPH_URL}/v1.0/${mediaId}`);
  url.searchParams.set("access_token", token);
  await call<{ success: boolean }>(url.toString(), { method: "DELETE" });
}
