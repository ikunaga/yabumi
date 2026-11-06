import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { envReady } from "@/lib/env-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { parseXSearch, xSearchCostUsd, xSearchParams, X_SEARCH_MAX_RESULTS, type XBuzzPost, type XSearchQuota } from "./search";

// X の人気の投稿を yabumi の中で探す（4.52）。予約 → 呼ぶ → 実際の額に直す。上限は DB の関数（reserve_x_search）の中で固定。
// 探した結果の一覧（他人の投稿）は返すだけで保存しない。検索の言葉も記録に残さない。
// ただし利用者が「この投稿を元にする」で選んだ投稿の文は、ネタを出すとネタ出しの会話の控え（ai_messages の xPost.text）に残る。
// それは X の決まり（保存した X Content を今の状態に保つ）に合わせ、1 日ほどで DB が消す（purge_expired_data。20261106190000_x_post_text_purge）

type Db = SupabaseClient<Database>;

export const X_SEARCH_URL = "https://api.x.com/2/tweets/search/recent";

// yabumi のアプリの鍵（Developer Console の「Bearer Token」。app-only。利用者の X のトークンは使わない）
export function xSearchConfigured(): boolean {
  return envReady("X の人気の投稿を探す", ["X_BEARER_TOKEN"]);
}

type QuotaRow = { status: string; used: number; limit_count: number; resets_on: string | null };

function toQuota(r: QuotaRow): XSearchQuota {
  const reason = r.status === "user_limit" || r.status === "new_user_limit" || r.status === "global_limit" || r.status === "new_global_limit" ? r.status : "ok";
  return { remaining: Math.max(0, r.limit_count - r.used), limit: r.limit_count, reason, resetsOn: r.resets_on };
}

// scopeOwner・asOf はテスト用（全体の上限を数える範囲と、いまの時刻）
type Scope = { scopeOwner?: string; asOf?: Date };

export async function loadXSearchQuota(admin: Db, userId: string, scope: Scope = {}): Promise<XSearchQuota> {
  const { data, error } = await admin
    .rpc("x_search_quota", { p_owner_id: userId, p_scope_owner: scope.scopeOwner, p_as_of: scope.asOf?.toISOString() })
    .single();
  if (error) throw error;
  return toQuota(data as QuotaRow);
}

export type XSearchResult =
  | { ok: true; posts: XBuzzPost[]; quota: XSearchQuota }
  | { ok: false; message: string; quota: XSearchQuota };

export type XSearchDeps = { fetch: typeof fetch; bearer: string };

const FAILED = "X から読み込めませんでした。時間をおいてもう一度お試しください。";

// 呼ぶ前に予約し、返ってきた件数と人数で実際の額に直す。失敗したら、請求されないとはっきりしているとき（4xx）だけ予約を消し、
// それ以外（5xx・タイムアウト・形の合わない応答）は予約の額のまま failed にする（AI の予約の M3 と同じ考え）
export async function runXSearch(admin: Db, deps: XSearchDeps, args: { userId: string; projectId: string; word: string } & Scope): Promise<XSearchResult> {
  const { data: reserved, error } = await admin
    .rpc("reserve_x_search", { p_owner_id: args.userId, p_project_id: args.projectId, p_scope_owner: args.scopeOwner, p_as_of: args.asOf?.toISOString() })
    .single();
  if (error) throw error;
  const r = reserved as QuotaRow & { usage_id: string | null };
  // 断ったとき（上限）は、その理由のまま返す（行は作っていない）
  if (!r.usage_id) return { ok: false, message: "", quota: toQuota(r) };
  const usageId = r.usage_id;
  // 終わったあとの残りの回数（使い切ったら、次に探せる日も）
  const fresh = () => loadXSearchQuota(admin, args.userId, args);
  const undo = async () => {
    await admin.from("x_search_usage").delete().eq("id", usageId);
    return fresh();
  };
  const markFailed = () => admin.from("x_search_usage").update({ status: "failed", settled_at: new Date().toISOString() }).eq("id", usageId);

  let res: Response;
  try {
    res = await deps.fetch(`${X_SEARCH_URL}?${xSearchParams(args.word)}`, {
      headers: { authorization: `Bearer ${deps.bearer}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error("[x-search] X に届きませんでした", e instanceof Error ? e.name : "error");
    await markFailed();
    return { ok: false, message: FAILED, quota: await fresh() };
  }
  if (!res.ok) {
    console.error("[x-search] X が断りました", res.status);
    if (res.status >= 400 && res.status < 500) {
      // 4xx は請求されない（数えない）。言葉が X に合わないとき（400）は、言葉を変えてもらう
      return { ok: false, message: res.status === 400 ? "この言葉では探せませんでした。言葉を変えてお試しください。" : FAILED, quota: await undo() };
    }
    await markFailed();
    return { ok: false, message: FAILED, quota: await fresh() };
  }
  const parsed = parseXSearch(await res.json().catch(() => null));
  if (!parsed) {
    await markFailed();
    return { ok: false, message: FAILED, quota: await fresh() };
  }
  await admin
    .from("x_search_usage")
    .update({
      status: "done",
      cost_usd: xSearchCostUsd(parsed.postCount, parsed.userCount),
      post_count: parsed.postCount,
      user_count: parsed.userCount,
      settled_at: new Date().toISOString(),
    })
    .eq("id", usageId);
  return { ok: true, posts: parsed.posts.slice(0, X_SEARCH_MAX_RESULTS), quota: await fresh() };
}

// 画面（ideas/page.tsx）で読む、ログイン中の利用者の残りの回数。鍵がなければ準備中
export async function currentXSearchQuota(): Promise<XSearchQuota> {
  const notReady: XSearchQuota = { remaining: 0, limit: 0, reason: "not_ready", resetsOn: null };
  if (!xSearchConfigured()) return notReady;
  const { data } = await (await createClient()).auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return notReady;
  return loadXSearchQuota(createAdminClient(), userId);
}
