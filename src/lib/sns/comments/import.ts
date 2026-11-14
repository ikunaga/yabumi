import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { loadAccount } from "@/lib/sns/publisher";
import type { SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { CommentsError, type CommentsAccount, type CommentsFetchers, type FetchedComment } from "./fetchers";
import { enabledCommentScopes, isCommentsSns } from "./scopes";

// SNS のコメントの取り込み（docs/design/sns-comments.md、docs/architecture.md の 4.70）。admin は RLS を通らないクライアント。
// 読むのは、SNS_COMMENTS で有効にした SNS で、コメントの権限つきでつないだアカウントの、送ってから 7 日以内の投稿だけ。
// 本文・名前はログに出さない（結果は件数と状態だけを返す）

type Admin = SupabaseClient<Database>;

export const HOUR_MS = 3600_000;
// 送ってから 2 日までは 3 時間ごと、それより後（7 日まで）は 12 時間ごと
export const FRESH_MS = 2 * 24 * HOUR_MS;
export const FRESH_INTERVAL_MS = 3 * HOUR_MS;
export const LATER_INTERVAL_MS = 12 * HOUR_MS;
// 次の回（3 時間ごとの呼び出し）に確実に入るよう、少し早めに予定する
export const SLACK_MS = 15 * 60_000;
// 回数の上限に当たったアカウントは、残りを 6 時間あける
export const RATE_BACKOFF_MS = 6 * HOUR_MS;
// 続けて 3 回失敗したら、12 時間あける
export const MAX_FAILS = 3;
export const CONCURRENCY = 6;

export function nextCheckAt(now: Date, publishedAt: Date, fails = 0): Date {
  const interval = fails >= MAX_FAILS ? LATER_INTERVAL_MS : now.getTime() - publishedAt.getTime() < FRESH_MS ? FRESH_INTERVAL_MS : LATER_INTERVAL_MS;
  return new Date(now.getTime() + interval - SLACK_MS);
}

export type CommentsImportDeps = {
  fetchers: CommentsFetchers;
  key?: Buffer;
  fetch?: typeof fetch;
  now?: () => Date;
  // SNS_COMMENTS の代わり（テスト）
  commentsEnv?: string;
  // テストの利用者だけに絞る
  ownerId?: string;
  limit?: number;
  // この時刻（ms）を過ぎたら新しいものに手をつけない（残りは次の回）
  deadlineMs?: number;
  adapters?: Partial<Record<SnsKey, SnsAdapter>>;
};

export type CommentsOutcome = {
  id: string;
  sns: string;
  result: "saved" | "unchanged" | "skipped" | "failed" | "stopped";
  added?: number;
  removed?: number;
  message?: string;
};

type Due = Database["public"]["Functions"]["due_sns_comment_targets"]["Returns"][number];

export async function runSnsCommentsImport(admin: Admin, deps: CommentsImportDeps): Promise<CommentsOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const late = () => Boolean(deps.deadlineMs && Date.now() > deps.deadlineMs);
  const scopes = enabledCommentScopes(deps.commentsEnv);
  if (Object.keys(scopes).length === 0) return [];

  const { data: due, error } = await admin.rpc("due_sns_comment_targets", {
    p_scopes: scopes,
    p_limit: deps.limit ?? 200,
    ...(deps.ownerId ? { p_owner_id: deps.ownerId } : {}),
    p_now: now.toISOString(),
  });
  if (error) throw error;

  // アカウントごとに、トークンを 1 回だけ読む（同時に読んでも 1 回）。null はトークンが切れている
  const accounts = new Map<string, Promise<{ externalId: string; accessToken: string } | null>>();
  const accountFor = (t: Due) => {
    let p = accounts.get(t.social_account_id);
    if (!p) {
      p = loadAccount(admin, t.social_account_id, t.account_external_id, { key: deps.key, now: deps.now }, isCommentsSns(t.sns) ? deps.adapters?.[t.sns] : undefined);
      accounts.set(t.social_account_id, p);
    }
    return p;
  };
  // 回数の上限に当たった・権限がないと言われたアカウントは、この回の残りを読まない
  const blocked = new Map<string, "rate" | "permission">();

  const outcomes: CommentsOutcome[] = [];
  const queue = [...(due ?? [])];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (late()) return;
      outcomes.push(await importOne(admin, t, deps, now, accountFor, blocked));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return outcomes;
}

async function savePoll(admin: Admin, t: Due, fields: Partial<Database["public"]["Tables"]["sns_comment_polls"]["Insert"]>) {
  const { error } = await admin
    .from("sns_comment_polls")
    .upsert({ post_target_id: t.post_target_id, owner_id: t.owner_id, next_check_at: new Date().toISOString(), ...fields });
  if (error) throw error;
}

async function importOne(
  admin: Admin,
  t: Due,
  deps: CommentsImportDeps,
  now: Date,
  accountFor: (t: Due) => Promise<{ externalId: string; accessToken: string } | null>,
  blocked: Map<string, "rate" | "permission">,
): Promise<CommentsOutcome> {
  const base = { id: t.post_target_id, sns: t.sns };
  const publishedAt = new Date(t.published_at);
  const fetcher = isCommentsSns(t.sns) ? deps.fetchers[t.sns] : undefined;
  if (!fetcher) return { ...base, result: "skipped" };
  const block = blocked.get(t.social_account_id);
  if (block === "rate") {
    await savePoll(admin, t, { next_check_at: new Date(now.getTime() + RATE_BACKOFF_MS).toISOString(), last_count: t.last_count, fails: t.fails });
    return { ...base, result: "skipped", message: "回数の上限" };
  }
  if (block === "permission") {
    await savePoll(admin, t, { stopped: true, next_check_at: now.toISOString(), last_count: t.last_count, fails: t.fails });
    return { ...base, result: "stopped", message: "権限がない（つなぎ直しが要る）" };
  }
  const token = await accountFor(t);
  if (!token) return { ...base, result: "skipped", message: "トークンが切れている（つなぎ直しが要る）" };
  const account: CommentsAccount = { ...token, handle: t.account_handle ?? "" };

  try {
    const res = await fetcher.list(account, t.external_post_id, { lastCount: t.last_count, fetchImpl: deps.fetch });
    if (res.kind === "unchanged") {
      await savePoll(admin, t, { next_check_at: nextCheckAt(now, publishedAt).toISOString(), last_checked_at: now.toISOString(), last_count: res.count, fails: 0 });
      return { ...base, result: "unchanged" };
    }
    const { added, removed } = await saveComments(admin, t, res.comments, res.complete);
    await savePoll(admin, t, {
      next_check_at: nextCheckAt(now, publishedAt).toISOString(),
      last_checked_at: now.toISOString(),
      // 一覧を最後まで読めなかったときは、次も一覧を読むように数を覚えない
      last_count: res.complete ? res.count : null,
      fails: 0,
    });
    return { ...base, result: "saved", added, removed };
  } catch (e) {
    const kind = e instanceof CommentsError ? e.kind : "other";
    const message = e instanceof Error ? e.message : String(e);
    if (kind === "permission") {
      blocked.set(t.social_account_id, "permission");
      await savePoll(admin, t, { stopped: true, next_check_at: now.toISOString(), last_count: t.last_count, fails: t.fails });
      return { ...base, result: "stopped", message };
    }
    if (kind === "gone") {
      // SNS の側で投稿が消えていた: コメントを消し、もう読まない
      const { error } = await admin.from("sns_comments").delete().eq("post_target_id", t.post_target_id);
      if (error) throw error;
      await savePoll(admin, t, { stopped: true, next_check_at: now.toISOString(), last_count: null, fails: t.fails });
      return { ...base, result: "stopped", message };
    }
    if (kind === "rate") {
      blocked.set(t.social_account_id, "rate");
      await savePoll(admin, t, { next_check_at: new Date(now.getTime() + RATE_BACKOFF_MS).toISOString(), last_count: t.last_count, fails: t.fails });
      return { ...base, result: "skipped", message };
    }
    const fails = Math.min(t.fails + 1, 100);
    await savePoll(admin, t, { next_check_at: nextCheckAt(now, publishedAt, fails).toISOString(), last_checked_at: now.toISOString(), last_count: t.last_count, fails });
    return { ...base, result: "failed", message };
  }
}

// 読んだコメントを保存する。見た・知らせた時刻は残す（新しい行だけ fetched_at が今になる）。
// 一覧を最後まで読めたときは、返ってこなかった行（SNS の側で消された・隠された）を消す
export async function saveComments(admin: Admin, t: Pick<Due, "post_target_id" | "owner_id" | "social_account_id" | "sns">, comments: FetchedComment[], complete: boolean) {
  const { data: before, error: e0 } = await admin.from("sns_comments").select("external_id").eq("post_target_id", t.post_target_id);
  if (e0) throw e0;
  const had = new Set((before ?? []).map((r) => r.external_id));
  // 同じ ID が 2 度返ってきても 1 行にする
  const rows = [...new Map(comments.map((c) => [c.externalId, c])).values()].map((c) => ({
    owner_id: t.owner_id,
    post_target_id: t.post_target_id,
    social_account_id: t.social_account_id,
    sns: t.sns as "threads" | "instagram" | "facebook",
    external_id: c.externalId,
    parent_external_id: c.parentExternalId,
    author_name: c.authorName,
    body: c.body,
    is_own: c.isOwn,
    commented_at: c.commentedAt.toISOString(),
  }));
  if (rows.length) {
    const { error } = await admin.from("sns_comments").upsert(rows, { onConflict: "post_target_id,external_id" });
    if (error) throw error;
  }
  let removed = 0;
  if (complete) {
    const keep = new Set(rows.map((r) => r.external_id));
    const gone = [...had].filter((id) => !keep.has(id));
    if (gone.length) {
      const { error } = await admin.from("sns_comments").delete().eq("post_target_id", t.post_target_id).in("external_id", gone);
      if (error) throw error;
      removed = gone.length;
    }
  }
  return { added: rows.filter((r) => !had.has(r.external_id)).length, removed };
}
