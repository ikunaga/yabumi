import { appSecretProof, FACEBOOK_API_VERSION, FACEBOOK_GRAPH_URL } from "@/lib/sns/facebook/api";
import { INSTAGRAM_API_VERSION, INSTAGRAM_GRAPH_URL } from "@/lib/sns/instagram/api";
import { THREADS_GRAPH_URL } from "@/lib/sns/threads/api";
import { X_API_URL } from "@/lib/sns/x/api";

// SNS の数字の読み方（docs/architecture.md の 4.22、F07 の段取り ④）。名前は SNS をまたいでそろえる:
// views（表示・閲覧）、reach（届いた人）、likes、replies、reposts、quotes、shares、saves、clicks、followers
// 送信の部品（adapters）とは分けて置く。読むだけで、書き込みはしない

export type MetricValues = Record<string, number>;

export { INSIGHTS_SCOPE, hasInsightsScope, insightsEnabled, withInsightsScope } from "./scopes";

export class InsightsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // 権限がない（つなぎ直しが要る）
    readonly permission: boolean,
  ) {
    super(message);
    this.name = "InsightsError";
  }
}

type GraphItem = { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } };

async function getJson<T>(url: URL, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || json.error) {
    const code = json.error?.code;
    // 10・200〜299: 権限がない
    const permission = code === 10 || (code !== undefined && code >= 200 && code < 300) || res.status === 403;
    throw new InsightsError(json.error?.message ?? `数字を読めませんでした（${res.status}）`, res.status, permission);
  }
  return json;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // 反応の種類ごとの数（{ like: 3, love: 1 }）は合計する
  if (v && typeof v === "object") {
    const sum = Object.values(v).reduce<number>((n, x) => n + (typeof x === "number" ? x : 0), 0);
    return sum;
  }
  return null;
}

// Graph API の insights の返事（data: [{ name, values: [{ value }] } または { total_value: { value } }]）を、名前 → 数にする
export function parseInsights(data: GraphItem[] | undefined, rename: Record<string, string>): MetricValues {
  const out: MetricValues = {};
  for (const item of data ?? []) {
    if (!item.name || !(item.name in rename)) continue;
    const value = num(item.total_value?.value) ?? num(item.values?.[item.values.length - 1]?.value);
    if (value !== null) out[rename[item.name]] = value;
  }
  return out;
}

export type InsightsAccount = { externalId: string; accessToken: string };

export type InsightsFetcher = {
  post(account: InsightsAccount, externalPostId: string, fetchImpl?: typeof fetch): Promise<MetricValues>;
  account(account: InsightsAccount, fetchImpl?: typeof fetch): Promise<MetricValues>;
};

// Threads（https://developers.facebook.com/docs/threads/insights）
const THREADS_POST = { views: "views", likes: "likes", replies: "replies", reposts: "reposts", quotes: "quotes", shares: "shares" };
export const threadsInsights: InsightsFetcher = {
  async post(account, id, fetchImpl = fetch) {
    const url = new URL(`${THREADS_GRAPH_URL}/v1.0/${encodeURIComponent(id)}/insights`);
    url.searchParams.set("metric", Object.keys(THREADS_POST).join(","));
    url.searchParams.set("access_token", account.accessToken);
    return parseInsights((await getJson<{ data?: GraphItem[] }>(url, fetchImpl)).data, THREADS_POST);
  },
  async account(account, fetchImpl = fetch) {
    const url = new URL(`${THREADS_GRAPH_URL}/v1.0/${encodeURIComponent(account.externalId)}/threads_insights`);
    url.searchParams.set("metric", "followers_count");
    url.searchParams.set("access_token", account.accessToken);
    return parseInsights((await getJson<{ data?: GraphItem[] }>(url, fetchImpl)).data, { followers_count: "followers" });
  },
};

// Instagram（Instagram Login。https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights）。
// impressions は廃止。複数枚の投稿（アルバム）は数字がないことがある
const INSTAGRAM_POST = { views: "views", reach: "reach", likes: "likes", comments: "replies", saved: "saves", shares: "shares", total_interactions: "interactions" };
export const instagramInsights: InsightsFetcher = {
  async post(account, id, fetchImpl = fetch) {
    const url = new URL(`${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}/${encodeURIComponent(id)}/insights`);
    url.searchParams.set("metric", Object.keys(INSTAGRAM_POST).join(","));
    url.searchParams.set("access_token", account.accessToken);
    return parseInsights((await getJson<{ data?: GraphItem[] }>(url, fetchImpl)).data, INSTAGRAM_POST);
  },
  async account(account, fetchImpl = fetch) {
    const url = new URL(`${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}/me`);
    url.searchParams.set("fields", "followers_count");
    url.searchParams.set("access_token", account.accessToken);
    const json = await getJson<{ followers_count?: unknown }>(url, fetchImpl);
    const f = num(json.followers_count);
    return f === null ? ({} as MetricValues) : { followers: f };
  },
};

// Facebook ページ（https://developers.facebook.com/docs/graph-api/reference/insights）。account はページ（トークンはページのもの）。
// post_impressions は 2025 年に廃止され、post_media_view などに変わった
const FACEBOOK_POST = { post_media_view: "views", post_total_media_view_unique: "reach", post_reactions_by_type_total: "likes", post_clicks: "clicks" };
export function facebookInsights(appSecret: () => string): InsightsFetcher {
  const withToken = (url: URL, token: string) => {
    url.searchParams.set("access_token", token);
    url.searchParams.set("appsecret_proof", appSecretProof(token, appSecret()));
    return url;
  };
  return {
    async post(account, id, fetchImpl = fetch) {
      const url = new URL(`${FACEBOOK_GRAPH_URL}/${FACEBOOK_API_VERSION}/${encodeURIComponent(id)}/insights`);
      url.searchParams.set("metric", Object.keys(FACEBOOK_POST).join(","));
      return parseInsights((await getJson<{ data?: GraphItem[] }>(withToken(url, account.accessToken), fetchImpl)).data, FACEBOOK_POST);
    },
    async account(account, fetchImpl = fetch) {
      const url = new URL(`${FACEBOOK_GRAPH_URL}/${FACEBOOK_API_VERSION}/${encodeURIComponent(account.externalId)}`);
      url.searchParams.set("fields", "followers_count");
      const json = await getJson<{ followers_count?: unknown }>(withToken(url, account.accessToken), fetchImpl);
      const f = num(json.followers_count);
      return f === null ? ({} as MetricValues) : { followers: f };
    },
  };
}

// X（https://docs.x.com/x-api/posts/lookup）。読むたびに費用がかかる（投稿 1 件 $0.005、ユーザー 1 件 $0.010）ので、
// 呼ぶ側（sns-import.ts）が読む前に費用を記録し、上限を確かめる。public_metrics には表示回数（impression_count）も入る。
// 権限は投稿のときから求めている tweet.read と users.read で足りる（つなぎ直しは要らない）
const X_POST = { impression_count: "views", like_count: "likes", reply_count: "replies", retweet_count: "reposts", quote_count: "quotes", bookmark_count: "saves" };

async function getX<T>(url: URL, token: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as T & { data?: unknown; detail?: string; title?: string; errors?: { detail?: string; message?: string }[] };
  if (!res.ok) {
    const message = json.detail ?? json.errors?.[0]?.detail ?? json.errors?.[0]?.message ?? json.title ?? `数字を読めませんでした（${res.status}）`;
    throw new InsightsError(message, res.status, res.status === 401 || res.status === 403);
  }
  // 消された投稿などは 200 で data がなく、errors だけが返る
  if (!json.data) throw new InsightsError(json.errors?.[0]?.detail ?? "見つかりませんでした", 404, false);
  return json;
}

function pick(metrics: Record<string, unknown> | undefined, rename: Record<string, string>): MetricValues {
  const out: MetricValues = {};
  for (const [from, to] of Object.entries(rename)) {
    const v = metrics?.[from];
    if (typeof v === "number" && Number.isFinite(v)) out[to] = v;
  }
  return out;
}

export const xInsights: InsightsFetcher = {
  async post(account, id, fetchImpl = fetch) {
    const url = new URL(`${X_API_URL}/2/tweets/${encodeURIComponent(id)}`);
    url.searchParams.set("tweet.fields", "public_metrics");
    const json = await getX<{ data?: { public_metrics?: Record<string, unknown> } }>(url, account.accessToken, fetchImpl);
    return pick(json.data?.public_metrics, X_POST);
  },
  async account(account, fetchImpl = fetch) {
    const url = new URL(`${X_API_URL}/2/users/me`);
    url.searchParams.set("user.fields", "public_metrics");
    const json = await getX<{ data?: { public_metrics?: Record<string, unknown> } }>(url, account.accessToken, fetchImpl);
    return pick(json.data?.public_metrics, { followers_count: "followers" });
  },
};
