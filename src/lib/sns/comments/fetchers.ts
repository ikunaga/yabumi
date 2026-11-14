import { appSecretProof, FACEBOOK_API_VERSION, FACEBOOK_GRAPH_URL } from "@/lib/sns/facebook/api";
import { INSTAGRAM_API_VERSION, INSTAGRAM_GRAPH_URL } from "@/lib/sns/instagram/api";
import { THREADS_GRAPH_URL } from "@/lib/sns/threads/api";
import type { CommentsSns } from "./scopes";

// SNS ごとのコメントの読み方（docs/design/sns-comments.md、docs/architecture.md の 4.70）。読むだけで、書き込みはしない。
// 返事の形は公式の資料（2026-11-14）から組み立てた。本物で確かめていないところは【未確認】と書く。
// 本文・名前はログやエラーの文に入れない（エラーは SNS の返したエラーの文と状態の番号だけ）

export type CommentsAccount = { externalId: string; accessToken: string; handle: string };

export type FetchedComment = {
  externalId: string;
  // 返信への返信のとき、親のコメントの ID（投稿に直接付いたものは null）
  parentExternalId: string | null;
  authorName: string;
  body: string;
  commentedAt: Date;
  isOwn: boolean;
};

export type CommentsResult =
  // complete: 一覧を最後まで読めた（返ってこなかった行は、SNS の側で消された・隠されたものとして消してよい）
  | { kind: "listed"; comments: FetchedComment[]; complete: boolean; count: number | null }
  // 数が前と同じなので、一覧は読まなかった（Instagram）
  | { kind: "unchanged"; count: number };

export type CommentsFetcher = {
  list(account: CommentsAccount, postId: string, opts: { lastCount: number | null; fetchImpl?: typeof fetch }): Promise<CommentsResult>;
};

// 1 投稿で読む上限（これを超えたら、残りは読まず、消えたものの片付けもしない）
export const MAX_COMMENTS_PER_POST = 200;
export const MAX_BODY_CHARS = 3000;
export const MAX_AUTHOR_CHARS = 100;

export type CommentsErrorKind = "permission" | "rate" | "gone" | "other";

export class CommentsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: CommentsErrorKind,
  ) {
    super(message);
    this.name = "CommentsError";
  }
}

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number } };

// Graph の失敗を分ける。10・200〜299: 権限がない。4・17・32・613: 回数の上限。100 の subcode 33・404: 投稿が見つからない
export function classifyGraphError(status: number, body: GraphErrorBody | null): CommentsErrorKind {
  const code = body?.error?.code;
  const sub = body?.error?.error_subcode;
  if (code === 10 || (code !== undefined && code >= 200 && code < 300) || status === 403) return "permission";
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) return "rate";
  if ((code === 100 && sub === 33) || status === 404) return "gone";
  return "other";
}

async function getJson<T>(url: URL, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => null)) as (T & GraphErrorBody) | null;
  if (!res.ok || !json || json.error) {
    throw new CommentsError(json?.error?.message ?? `コメントを読めませんでした（${res.status}）`, res.status, classifyGraphError(res.status, json));
  }
  return json;
}

const cut = (s: unknown, n: number) => {
  const t = typeof s === "string" ? s : "";
  return [...t].length > n ? [...t].slice(0, n).join("") : t;
};

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Page<T> = { data?: T[]; paging?: { next?: string } };

// paging.next をたどって、上限まで読む。next の URL は同じ SNS のものだけを使う（トークンが付いて返るので、ほかへは送らない）
async function readPages<T>(first: URL, fetchImpl: typeof fetch, size: (item: T) => number): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let total = 0;
  let url: URL | null = first;
  while (url) {
    const page: Page<T> = await getJson<Page<T>>(url, fetchImpl);
    for (const item of page.data ?? []) {
      items.push(item);
      total += size(item);
    }
    const next = page.paging?.next;
    if (!next) return { items, complete: true };
    if (total >= MAX_COMMENTS_PER_POST) return { items, complete: false };
    const nextUrl = new URL(next);
    if (nextUrl.origin !== first.origin) return { items, complete: false };
    url = nextUrl;
  }
  return { items, complete: true };
}

// ── Threads（https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies） ──
// /conversation は、返信への返信も含めて平らに返す。replied_to が投稿そのものなら、投稿に直接付いた返信
type ThreadsReply = { id?: string; text?: string; username?: string; timestamp?: string; hide_status?: string; replied_to?: { id?: string } };
// 見せていない返信（利用者が隠した・制限した）は保存しない【未確認: 値の一覧】
const THREADS_HIDDEN = new Set(["HIDDEN", "COVERED", "BLOCKED", "RESTRICTED"]);

export const threadsComments: CommentsFetcher = {
  async list(account, postId, { fetchImpl = fetch }) {
    const url = new URL(`${THREADS_GRAPH_URL}/v1.0/${encodeURIComponent(postId)}/conversation`);
    url.searchParams.set("fields", "id,text,username,timestamp,hide_status,replied_to");
    url.searchParams.set("reverse", "false");
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", account.accessToken);
    const { items, complete } = await readPages<ThreadsReply>(url, fetchImpl, () => 1);
    const comments: FetchedComment[] = [];
    for (const r of items) {
      const at = toDate(r.timestamp);
      if (!r.id || !at || (r.hide_status && THREADS_HIDDEN.has(r.hide_status))) continue;
      const parent = r.replied_to?.id && r.replied_to.id !== postId ? r.replied_to.id : null;
      comments.push({
        externalId: r.id,
        parentExternalId: parent,
        authorName: cut(r.username ? `@${r.username}` : "", MAX_AUTHOR_CHARS),
        body: cut(r.text, MAX_BODY_CHARS),
        commentedAt: at,
        isOwn: Boolean(account.handle && r.username === account.handle),
      });
    }
    return { kind: "listed", comments, complete, count: null };
  },
};

// ── Instagram（Instagram ログイン。https://developers.facebook.com/documentation/instagram-platform/reference/ig-comment） ──
// 先に投稿の comments_count を読み、前と同じなら一覧は読まない（回数を節約する）
type IgComment = { id?: string; text?: string; username?: string; timestamp?: string; hidden?: boolean; from?: { id?: string; username?: string } };
type IgTop = IgComment & { replies?: { data?: IgComment[]; paging?: { next?: string } } };

export const instagramComments: CommentsFetcher = {
  async list(account, postId, { lastCount, fetchImpl = fetch }) {
    const base = `${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}/${encodeURIComponent(postId)}`;
    const head = new URL(base);
    head.searchParams.set("fields", "comments_count");
    head.searchParams.set("access_token", account.accessToken);
    const media = await getJson<{ comments_count?: number }>(head, fetchImpl);
    const count = typeof media.comments_count === "number" ? media.comments_count : null;
    if (count !== null && lastCount !== null && count === lastCount) return { kind: "unchanged", count };

    const url = new URL(`${base}/comments`);
    url.searchParams.set("fields", "id,text,username,timestamp,hidden,from,replies{id,text,username,timestamp,hidden,from}");
    url.searchParams.set("limit", "50");
    url.searchParams.set("access_token", account.accessToken);
    const { items, complete } = await readPages<IgTop>(url, fetchImpl, (c) => 1 + (c.replies?.data?.length ?? 0));
    let all = complete;
    const comments: FetchedComment[] = [];
    const push = (c: IgComment, parent: string | null) => {
      const at = toDate(c.timestamp);
      if (!c.id || !at || c.hidden) return;
      const name = c.username ?? c.from?.username ?? "";
      comments.push({
        externalId: c.id,
        parentExternalId: parent,
        authorName: cut(name ? `@${name}` : "", MAX_AUTHOR_CHARS),
        body: cut(c.text, MAX_BODY_CHARS),
        commentedAt: at,
        isOwn: Boolean((c.from?.id && c.from.id === account.externalId) || (account.handle && name === account.handle)),
      });
    };
    for (const c of items) {
      push(c, null);
      // replies は 1 ページ分だけ読む。続きがあるときは、消えたものの片付けをしない（complete にしない）
      for (const r of c.replies?.data ?? []) if (c.id) push(r, c.id);
      if (c.replies?.paging?.next) all = false;
    }
    return { kind: "listed", comments, complete: all, count };
  },
};

// ── Facebook ページ（https://developers.facebook.com/docs/graph-api/reference/object/comments） ──
// filter=stream で返信への返信も平らに返る。トークンはページのもの。from が返らないことがある（その人が許可していないとき【未確認】）
type FbComment = { id?: string; message?: string; created_time?: string; is_hidden?: boolean; from?: { id?: string; name?: string }; parent?: { id?: string } };

export function facebookComments(appSecret: () => string): CommentsFetcher {
  return {
    async list(account, postId, { fetchImpl = fetch }) {
      const url = new URL(`${FACEBOOK_GRAPH_URL}/${FACEBOOK_API_VERSION}/${encodeURIComponent(postId)}/comments`);
      url.searchParams.set("filter", "stream");
      url.searchParams.set("order", "chronological");
      url.searchParams.set("fields", "id,message,created_time,is_hidden,from{id,name},parent{id}");
      url.searchParams.set("limit", "100");
      url.searchParams.set("access_token", account.accessToken);
      url.searchParams.set("appsecret_proof", appSecretProof(account.accessToken, appSecret()));
      const { items, complete } = await readPages<FbComment>(url, fetchImpl, () => 1);
      const comments: FetchedComment[] = [];
      for (const c of items) {
        const at = toDate(c.created_time);
        if (!c.id || !at || c.is_hidden) continue;
        comments.push({
          externalId: c.id,
          parentExternalId: c.parent?.id ?? null,
          authorName: cut(c.from?.name ?? "", MAX_AUTHOR_CHARS),
          body: cut(c.message, MAX_BODY_CHARS),
          commentedAt: at,
          isOwn: Boolean(c.from?.id && c.from.id === account.externalId),
        });
      }
      return { kind: "listed", comments, complete, count: null };
    },
  };
}

export type CommentsFetchers = Partial<Record<CommentsSns, CommentsFetcher>>;
