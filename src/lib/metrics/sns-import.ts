import type { SupabaseClient } from "@supabase/supabase-js";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { hasInsightsScope, insightsEnabled, InsightsError, type InsightsFetcher } from "@/lib/sns/insights";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { loadAccount } from "@/lib/sns/publisher";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";
import type { Database, Json } from "@/lib/supabase/database.types";

// SNS の数字の毎日の取り込み（docs/architecture.md の 4.22、F07 の段取り ④）。admin は RLS を通らないクライアント。
// 読むのは、SNS_INSIGHTS で有効にした SNS で、数字の権限つきでつないだアカウントだけ（権限なしでつないだ人は、つなぎ直すと読めるようになる）

type Admin = SupabaseClient<Database>;

export type SnsMetricsDeps = {
  fetchers: Partial<Record<SnsKey, InsightsFetcher>>;
  fetch?: typeof fetch;
  key?: Buffer;
  now?: () => Date;
  insightsEnv?: string;
  // テストの利用者だけに絞る
  ownerId?: string;
  // この時刻（ms）を過ぎたら新しいものに手をつけない（残りは次の回）
  deadlineMs?: number;
  limit?: number;
  // トークンの延長（X は 2 時間で切れるので、延長してから読む）
  adapters?: Partial<Record<SnsKey, SnsAdapter>>;
  // X の数字の費用の上限（米ドル）。ないと X は読まない。budgetUsd は矢書全体の X の月の上限（投稿と共有）、
  // userBudgetUsd は利用者 1 人の X の数字の月の上限。scopeOwner はテスト用（上限を数える範囲をその利用者だけにする）
  x?: { budgetUsd: number; userBudgetUsd: number; scopeOwner?: string };
};

export type SnsMetricsOutcome = { kind: "post" | "account"; id: string; sns: string; result: "saved" | "skipped" | "failed"; message?: string };

async function scopesOf(admin: Admin, socialAccountId: string): Promise<string[]> {
  const { data } = await admin.from("social_account_tokens").select("scopes").eq("social_account_id", socialAccountId).maybeSingle();
  return data?.scopes ?? [];
}

export async function runSnsMetricsImport(admin: Admin, deps: SnsMetricsDeps): Promise<SnsMetricsOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const outcomes: SnsMetricsOutcome[] = [];
  const late = () => Boolean(deps.deadlineMs && Date.now() > deps.deadlineMs);
  // アカウントごとに、読めるか（権限）とトークンを 1 回だけ確かめる
  const accounts = new Map<string, { externalId: string; accessToken: string } | null>();
  async function accountFor(socialAccountId: string, externalId: string, sns: SnsKey) {
    if (accounts.has(socialAccountId)) return accounts.get(socialAccountId)!;
    let ready: { externalId: string; accessToken: string } | null = null;
    if (insightsEnabled(sns, deps.insightsEnv) && hasInsightsScope(sns, await scopesOf(admin, socialAccountId))) {
      ready = await loadAccount(admin, socialAccountId, externalId, { key: deps.key, now: deps.now }, deps.adapters?.[sns]);
    }
    accounts.set(socialAccountId, ready);
    return ready;
  }

  // X は読むたびに費用がかかる。読む前に費用を記録し（上限を超えるなら読まない）、読めなかったら記録を消す
  async function reserveX(ownerId: string, postTargetId: string | null, operation: "metrics_read" | "followers_read"): Promise<string | null> {
    if (!deps.x) return null;
    const { data, error } = await admin.rpc("reserve_x_metrics_read", {
      p_owner_id: ownerId,
      p_post_target_id: postTargetId as string,
      p_operation: operation,
      p_cost_usd: X_PRICE_USD[operation],
      p_budget_usd: deps.x.budgetUsd,
      p_user_budget_usd: deps.x.userBudgetUsd,
      p_scope_owner: (deps.x.scopeOwner ?? null) as string,
    });
    if (error) throw error;
    return data;
  }
  const releaseX = async (usageId: string | null) => {
    if (usageId) await admin.from("sns_api_usage").delete().eq("id", usageId);
  };
  const X_OVER = "X の数字の月の上限に達した";

  // ① 投稿の数字（送ってから決まった日）
  const { data: due, error } = await admin.rpc("due_post_metric_targets", {
    p_limit: deps.limit ?? 100,
    ...(deps.ownerId ? { p_owner_id: deps.ownerId } : {}),
    p_now: now.toISOString(),
  });
  if (error) throw error;
  for (const t of due ?? []) {
    if (late()) break;
    const fetcher = isSnsKey(t.sns) ? deps.fetchers[t.sns] : undefined;
    const base = { kind: "post" as const, id: t.post_target_id, sns: t.sns };
    if (!fetcher || !isSnsKey(t.sns)) {
      outcomes.push({ ...base, result: "skipped" });
      continue;
    }
    const account = await accountFor(t.social_account_id, t.account_external_id, t.sns);
    if (!account) {
      outcomes.push({ ...base, result: "skipped", message: "数字の権限がない" });
      continue;
    }
    let usageId: string | null = null;
    if (t.sns === "x" && !deps.x) {
      outcomes.push({ ...base, result: "skipped", message: "X の上限の設定がない" });
      continue;
    }
    if (t.sns === "x") {
      usageId = await reserveX(t.owner_id, t.post_target_id, "metrics_read");
      if (!usageId) {
        outcomes.push({ ...base, result: "skipped", message: X_OVER });
        continue;
      }
    }
    try {
      const values = await fetcher.post(account, t.external_post_id, deps.fetch).catch(async (e) => {
        await releaseX(usageId);
        throw e;
      });
      const { error: e } = await admin
        .from("post_metrics")
        .upsert({ post_target_id: t.post_target_id, owner_id: t.owner_id, day_index: t.day_index, values: values as Json, captured_at: now.toISOString() });
      if (e) throw e;
      outcomes.push({ ...base, result: "saved" });
    } catch (e) {
      // 権限がないと言われたら、このアカウントの残りは読まない（つなぎ直すまで）
      if (e instanceof InsightsError && e.permission) accounts.set(t.social_account_id, null);
      outcomes.push({ ...base, result: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // ② アカウントの数字（フォロワー数。日本時間で 1 日 1 回）
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
  const { data: dueAccounts, error: e2 } = await admin.rpc("due_account_metric_accounts", {
    p_limit: deps.limit ?? 100,
    ...(deps.ownerId ? { p_owner_id: deps.ownerId } : {}),
    p_now: now.toISOString(),
  });
  if (e2) throw e2;
  for (const a of dueAccounts ?? []) {
    if (late()) break;
    const fetcher = isSnsKey(a.sns) ? deps.fetchers[a.sns] : undefined;
    const base = { kind: "account" as const, id: a.social_account_id, sns: a.sns };
    if (!fetcher || !isSnsKey(a.sns)) {
      outcomes.push({ ...base, result: "skipped" });
      continue;
    }
    const account = await accountFor(a.social_account_id, a.external_id, a.sns);
    if (!account) {
      outcomes.push({ ...base, result: "skipped", message: "数字の権限がない" });
      continue;
    }
    let usageId: string | null = null;
    if (a.sns === "x" && !deps.x) {
      outcomes.push({ ...base, result: "skipped", message: "X の上限の設定がない" });
      continue;
    }
    if (a.sns === "x") {
      usageId = await reserveX(a.owner_id, null, "followers_read");
      if (!usageId) {
        outcomes.push({ ...base, result: "skipped", message: X_OVER });
        continue;
      }
    }
    try {
      const values = await fetcher.account(account, deps.fetch).catch(async (e) => {
        await releaseX(usageId);
        throw e;
      });
      const { error: e } = await admin
        .from("account_metrics")
        .upsert({ social_account_id: a.social_account_id, owner_id: a.owner_id, day, values: values as Json, captured_at: now.toISOString() });
      if (e) throw e;
      outcomes.push({ ...base, result: "saved" });
    } catch (e) {
      outcomes.push({ ...base, result: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}
