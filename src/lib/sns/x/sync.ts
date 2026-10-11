import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { loadAccount, type PublisherDeps } from "@/lib/sns/publisher";
import type { Database } from "@/lib/supabase/database.types";
import { X_API_URL } from "./api";

// X の開発者規約への対応: X 側で消された投稿の情報を、矢書でも最新に保つ（docs/architecture.md の 4.19）。
// 矢書が持つ X の情報は、矢書から送った（または手で投稿して記録した）投稿の ID と URL だけ。
// 投稿を読むのは 1 件 $0.005 かかるので、利用者が投稿の画面を開いたときに、その投稿の X の配信先だけを、24 時間に 1 回まで確かめる。
// 消えていたら、配信先を「取り消し済み」にして ID と URL を消す（DB のトリガー）。費用は sns_api_usage に記録し、X の月の上限に数える。

type Admin = SupabaseClient<Database>;

// X の投稿を読む単価（米ドル、1 件。https://docs.x.com/x-api/getting-started/pricing の Posts: Read、2026-10-11）
export const X_POST_READ_USD = 0.005;
// 同じ投稿を確かめ直すまでの間（X は同じものを 1 日（UTC）に何度読んでも 1 回分なので、それより短くしても費用は変わらないが、回数を抑える）
export const X_RECHECK_MS = 24 * 3600_000;
// 1 人が 1 日（日本時間）に確かめられる回数。X の上限は矢書全体で共有なので、1 人が投稿の画面を開き続けたり、
// 手で投稿した記録（URL は利用者が入れられる）をたくさん作ったりして、ほかの人の投稿の分を使い切らないようにする（最大 $0.15 / 日）
export const X_MAX_READS_PER_USER_PER_DAY = 30;
// 送ってすぐは確かめない（確かめる意味がない）
export const X_CHECK_AFTER_PUBLISH_MS = 10 * 60_000;

export type PostState = "exists" | "removed";

export class XReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "XReadError";
  }
}

// GET /2/tweets/:id。見つからない（消された）ときは、200 で errors に resource-not-found が入る（404 のこともある）
export async function readXPostState(token: string, postId: string): Promise<PostState> {
  const res = await fetch(`${X_API_URL}/2/tweets/${encodeURIComponent(postId)}`, {
    method: "GET",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; errors?: { type?: string }[]; type?: string };
  const notFound = (t?: string) => Boolean(t && t.endsWith("/resource-not-found"));
  if (res.ok && json.data?.id) return "exists";
  if ((res.ok || res.status === 404) && (json.errors?.some((e) => notFound(e.type)) || notFound(json.type))) return "removed";
  throw new XReadError(`X の投稿を確かめられませんでした（${res.status}）`, res.status);
}

// 手で投稿して記録した X の投稿は、URL（https://x.com/<名前>/status/<ID>）から ID を取る
export function xPostIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[^/]+|i\/web)\/status\/(\d{1,25})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

export type SyncDeps = {
  publisher: Pick<PublisherDeps, "key" | "now" | "refreshWait">;
  adapter: SnsAdapter;
  // X の月の上限（米ドル、矢書全体）。null なら上限なし
  budgetUsd: number | null;
  // 上限を数える範囲（テスト用。publisher.ts の budgetScopeOwner と同じ）
  budgetScopeOwner?: string;
  readPost?: (token: string, postId: string) => Promise<PostState>;
  // アクセストークンを読む（つながっていなければ null）。テストでは、DB のアカウントの状態に左右されないよう差し替える
  loadToken?: (socialAccountId: string) => Promise<string | null>;
};

// つながっている X のアカウントの、使えるアクセストークン（切れていれば取り直す）
async function loadActiveToken(admin: Admin, deps: SyncDeps, socialAccountId: string): Promise<string | null> {
  const { data: acc } = await admin.from("social_accounts").select("external_id, status").eq("id", socialAccountId).maybeSingle();
  if (!acc || acc.status !== "active") return null;
  const account = await loadAccount(admin, socialAccountId, acc.external_id, deps.publisher, deps.adapter);
  return account?.accessToken ?? null;
}

export type SyncOutcome = { targetId: string; result: "exists" | "removed" | "skipped" };

// 1 つの投稿の X の配信先を確かめる。呼ぶ前に、postId が利用者本人の投稿であることを確かめておく（admin は RLS を通らない）
export async function syncXTargetsOfPost(admin: Admin, deps: SyncDeps, postId: string): Promise<SyncOutcome[]> {
  const now = deps.publisher.now?.() ?? new Date();
  const { data: targets, error } = await admin
    .from("post_targets")
    .select("id, owner_id, external_post_id, external_url, published_at, sns_checked_at, social_account_id")
    .eq("post_id", postId)
    .eq("sns", "x")
    .eq("status", "published");
  if (error) throw error;

  const outcomes: SyncOutcome[] = [];
  for (const t of targets) {
    const skip = () => outcomes.push({ targetId: t.id, result: "skipped" });
    const xId = t.external_post_id ?? xPostIdFromUrl(t.external_url);
    if (!xId || !t.social_account_id) {
      skip();
      continue;
    }
    if (t.published_at && now.getTime() - new Date(t.published_at).getTime() < X_CHECK_AFTER_PUBLISH_MS) {
      skip();
      continue;
    }
    if (t.sns_checked_at && now.getTime() - new Date(t.sns_checked_at).getTime() < X_RECHECK_MS) {
      skip();
      continue;
    }

    const token = await (deps.loadToken ?? ((id: string) => loadActiveToken(admin, deps, id)))(t.social_account_id);
    if (!token) {
      skip();
      continue;
    }

    // 読む前に費用を記録する。月の上限（矢書全体）か、1 人 1 日の回数の上限に達していれば確かめない（投稿のほうを優先する）。
    // 2 つの上限の確かめと記録は、DB の中で 1 つのロックの中で行う（同時に呼ばれても回数を超えない）
    const { data: usageId, error: reserveError } = await admin.rpc("reserve_sns_read", {
      p_owner_id: t.owner_id,
      p_sns: "x",
      p_post_target_id: t.id,
      p_cost_usd: X_POST_READ_USD,
      p_budget_usd: deps.budgetUsd as number,
      p_daily_limit: X_MAX_READS_PER_USER_PER_DAY,
      p_scope_owner: (deps.budgetScopeOwner ?? null) as string,
    });
    if (reserveError) throw reserveError;
    if (!usageId) {
      skip();
      continue;
    }

    let state: PostState;
    try {
      state = await (deps.readPost ?? readXPostState)(token, xId);
    } catch (e) {
      // 読めなかった（接続切れ・上限・X の障害）ときは、費用がかかっていないとみなして記録を消し、次に画面を開いたときにまた確かめる
      console.error("[x-sync]", e instanceof Error ? e.message : e);
      await admin.from("sns_api_usage").delete().eq("id", usageId);
      skip();
      continue;
    }

    const update =
      state === "removed"
        ? { status: "deleted", sns_removed_at: now.toISOString(), sns_checked_at: now.toISOString() }
        : { sns_checked_at: now.toISOString() };
    const { error: updateError } = await admin.from("post_targets").update(update).eq("id", t.id).eq("status", "published");
    if (updateError) throw updateError;
    outcomes.push({ targetId: t.id, result: state });
  }
  return outcomes;
}
