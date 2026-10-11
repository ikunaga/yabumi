import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import { refreshTokenAad } from "./accounts";
import { isSnsKey, SNS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { SnsPublishError, type AdapterAccount, type RefreshedTokens, type SnsAdapter } from "./adapters/types";

// 送信ジョブの本体。RLS を通らないクライアント（createAdminClient）で呼ぶ。方針は docs/architecture.md の 4.7
type Admin = SupabaseClient<Database>;
type Adapters = Partial<Record<SnsKey, SnsAdapter>>;
export type PublisherDeps = {
  adapters: Adapters;
  key?: Buffer;
  now?: () => Date;
  // 使った分だけ払う SNS の、月の上限（米ドル、矢書全体）。ない SNS は上限なし
  budgetsUsd?: Partial<Record<SnsKey, number>>;
  // 延長をほかの処理が行っているとき、待つ間隔と回数（テストで短くする）
  refreshWait?: { intervalMs: number; tries: number };
};

// 1 つの配信先につき最大 3 回まで試す。2 回目は 1 分後、3 回目は 5 分後
export const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

export function retryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[attempts - 1] ?? null;
}

export type ClaimedTarget = Database["public"]["Functions"]["claim_due_targets"]["Returns"][number];
export type TargetOutcome = { targetId: string; postId: string; sns: string; result: "published" | "retry" | "failed"; message?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// トークンを読み出す。使えないならアカウントを「期限切れ」にして null を返す。
// リフレッシュトークンで取り直す SNS（X）は、アクセストークンが切れそうなら取り直してから返す
export async function loadAccount(
  admin: Admin,
  socialAccountId: string,
  externalId: string,
  deps: Pick<PublisherDeps, "key" | "now" | "refreshWait">,
  adapter?: SnsAdapter,
): Promise<AdapterAccount | null> {
  const { data, error } = await admin
    .from("social_account_tokens")
    .select("access_token_encrypted, refresh_token_encrypted, expires_at")
    .eq("social_account_id", socialAccountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const now = deps.now?.() ?? new Date();

  if (adapter?.refreshWithRefreshToken) {
    if (!data.refresh_token_encrypted) {
      // リフレッシュトークンがない（offline.access なしでつないだ）ときは、アクセストークンが切れたら終わり
      if (data.expires_at && new Date(data.expires_at) <= now) {
        await markAccountExpired(admin, socialAccountId);
        return null;
      }
    } else if (!data.expires_at || new Date(data.expires_at).getTime() - now.getTime() < ACCESS_TOKEN_MARGIN_MS) {
      const accessToken = await refreshOnce(admin, socialAccountId, adapter, deps);
      return accessToken ? { externalId, accessToken } : null;
    }
    return { externalId, accessToken: decryptToken(data.access_token_encrypted, socialAccountId, deps.key) };
  }

  if (data.expires_at && new Date(data.expires_at) <= now) {
    await markAccountExpired(admin, socialAccountId);
    return null;
  }
  return { externalId, accessToken: decryptToken(data.access_token_encrypted, socialAccountId, deps.key) };
}

// 送信の途中でアクセストークンが切れないよう、残りがこれより短ければ取り直す
export const ACCESS_TOKEN_MARGIN_MS = 5 * 60 * 1000;

// リフレッシュトークンでアクセストークンを取り直す。X のリフレッシュトークンは使い捨てなので、
// 同時に 2 か所で取り直すと片方が失効させてしまう。DB の claim_token_refresh で権利を取った 1 か所だけが取り直し、
// ほかは取り直しが終わるのを待って新しいトークンを読む。
// force: 期限に関係なく取り直す（日次のジョブで、使われないリフレッシュトークンを新しくするとき）
export async function refreshOnce(
  admin: Admin,
  socialAccountId: string,
  adapter: SnsAdapter,
  deps: Pick<PublisherDeps, "key" | "now" | "refreshWait">,
  { force = false }: { force?: boolean } = {},
): Promise<string | null> {
  const wait = deps.refreshWait ?? { intervalMs: 500, tries: 20 };
  for (let i = 0; i <= wait.tries; i++) {
    const now = deps.now?.() ?? new Date();
    const { data, error } = await admin.rpc("claim_token_refresh", { p_social_account_id: socialAccountId, p_lease_seconds: 30 });
    if (error) throw error;
    const row = data[0];
    if (!row) {
      // ほかの処理が取り直している。終わるまで待ってから、もう一度見る
      if (i < wait.tries) await sleep(wait.intervalMs);
      continue;
    }

    const release = async (patch: Database["public"]["Tables"]["social_account_tokens"]["Update"] = {}) => {
      const { error: e } = await admin
        .from("social_account_tokens")
        .update({ ...patch, refresh_locked_until: null })
        .eq("social_account_id", socialAccountId);
      if (e) throw e;
    };

    // 待っている間に、ほかの処理が取り直し終えていれば、それを使う
    const fresh = row.expires_at && new Date(row.expires_at).getTime() - now.getTime() >= ACCESS_TOKEN_MARGIN_MS;
    if (fresh && !force) {
      await release();
      return decryptToken(row.access_token_encrypted, socialAccountId, deps.key);
    }
    if (!row.refresh_token_encrypted) {
      await release();
      await markAccountExpired(admin, socialAccountId);
      return null;
    }

    let refreshed: RefreshedTokens;
    try {
      refreshed = await adapter.refreshWithRefreshToken!(decryptToken(row.refresh_token_encrypted, refreshTokenAad(socialAccountId), deps.key), now);
    } catch (e) {
      await release();
      if (e instanceof SnsPublishError && e.kind === "auth") {
        await markAccountExpired(admin, socialAccountId);
        return null;
      }
      throw e;
    }
    await release({
      access_token_encrypted: encryptToken(refreshed.accessToken, socialAccountId, deps.key),
      // 新しいリフレッシュトークンが返らなかったときは、今のものを使い続ける
      ...(refreshed.refreshToken
        ? { refresh_token_encrypted: encryptToken(refreshed.refreshToken, refreshTokenAad(socialAccountId), deps.key) }
        : {}),
      expires_at: refreshed.expiresAt.toISOString(),
    });
    return refreshed.accessToken;
  }
  throw new SnsPublishError("retryable", "SNS の接続の更新に時間がかかっています。時間をおいて送り直します。");
}

async function markAccountExpired(admin: Admin, socialAccountId: string) {
  await admin.from("social_accounts").update({ status: "expired" }).eq("id", socialAccountId);
}

const RECONNECT = "概要の「つないだ SNS」からつなぎ直してください。";

// 費用を先に記録する。上限を超えるなら null（DB の reserve_sns_spend が、同じ SNS の記録を順に行う）
async function reserveSpend(
  admin: Admin,
  targetId: string,
  sns: SnsKey,
  operation: string,
  costUsd: number,
  budgetUsd: number | null,
): Promise<string | null> {
  const { data: target, error: targetError } = await admin.from("post_targets").select("owner_id").eq("id", targetId).single();
  if (targetError) throw targetError;
  const { data, error } = await admin.rpc("reserve_sns_spend", {
    p_owner_id: target.owner_id,
    p_sns: sns,
    p_post_target_id: targetId,
    p_operation: operation,
    p_cost_usd: costUsd,
    p_budget_usd: budgetUsd as number,
  });
  if (error) throw error;
  return data;
}

async function releaseSpend(admin: Admin, usageId: string) {
  const { error } = await admin.from("sns_api_usage").delete().eq("id", usageId);
  if (error) console.error("[publish] 費用の記録を消せませんでした", error.message);
}

async function publishOne(admin: Admin, t: ClaimedTarget, deps: PublisherDeps): Promise<TargetOutcome> {
  const base = { targetId: t.target_id, postId: t.post_id, sns: t.sns };
  const now = deps.now?.() ?? new Date();

  const fail = async (message: string): Promise<TargetOutcome> => {
    const { error } = await admin
      .from("post_targets")
      .update({ status: "failed", error_message: message, locked_at: null, next_attempt_at: null })
      .eq("id", t.target_id);
    if (error) throw error;
    return { ...base, result: "failed", message };
  };

  const adapter = isSnsKey(t.sns) ? deps.adapters[t.sns] : undefined;
  const label = isSnsKey(t.sns) ? SNS[t.sns].label : t.sns;
  if (!adapter) return fail(`${label} への送信はまだ準備中です。`);
  if (!t.social_account_id || !t.account_external_id) return fail(`${label} のアカウントがつながっていません。${RECONNECT}`);
  if (t.account_status !== "active") return fail(`${label} の接続が切れています。${RECONNECT}`);

  // 使った分だけ払う SNS は、送る前に費用を記録する（月の上限を超えるなら送らない）。送れなかったと確かなときは記録を消す
  let usageId: string | null = null;
  try {
    const account = await loadAccount(admin, t.social_account_id, t.account_external_id, deps, adapter);
    if (!account) return fail(`${label} の接続が切れています。${RECONNECT}`);

    if (adapter.publishCost && isSnsKey(t.sns)) {
      const cost = adapter.publishCost(t.body);
      const budget = deps.budgetsUsd?.[t.sns];
      usageId = await reserveSpend(admin, t.target_id, t.sns, cost.operation, cost.costUsd, budget ?? null);
      if (!usageId) {
        return fail(
          `今月の ${label} の上限（$${budget}）に達しました。来月まで自動では送りません。送信の結果から、手で投稿して記録できます。`,
        );
      }
    }

    const result = await adapter.publishText(account, t.body);
    const { error } = await admin
      .from("post_targets")
      .update({
        status: "published",
        external_post_id: result.externalPostId,
        external_url: result.url,
        published_at: now.toISOString(),
        error_message: null,
        locked_at: null,
        next_attempt_at: null,
      })
      .eq("id", t.target_id);
    if (error) throw error;
    return { ...base, result: "published" };
  } catch (e) {
    const err =
      e instanceof SnsPublishError
        ? e
        : new SnsPublishError("unknown", "送信中に予期しないエラーが起きました。SNS 側に投稿されているか確かめてください。", { cause: e });
    if (!(e instanceof SnsPublishError)) console.error("[publish] 予期しないエラー", e);

    if (err.kind === "auth") await markAccountExpired(admin, t.social_account_id);
    // 投稿されたかわからない（unknown）ときは、払っている見込みとして記録を残す
    if (usageId && err.kind !== "unknown") await releaseSpend(admin, usageId);

    const delay = err.kind === "retryable" ? retryDelayMs(t.attempts) : null;
    if (delay !== null) {
      const { error } = await admin
        .from("post_targets")
        .update({
          status: "pending",
          error_message: err.userMessage,
          locked_at: null,
          next_attempt_at: new Date(now.getTime() + delay).toISOString(),
        })
        .eq("id", t.target_id);
      if (error) throw error;
      return { ...base, result: "retry", message: err.userMessage };
    }
    return fail(err.userMessage);
  }
}

// 送る時刻が来た配信先を取り出して送る。postId を渡すとその投稿だけ（「今すぐ送る」）
export async function publishDueTargets(
  admin: Admin,
  deps: PublisherDeps,
  options: { limit?: number; postId?: string } = {},
): Promise<TargetOutcome[]> {
  const { data, error } = await admin.rpc("claim_due_targets", {
    p_limit: options.limit ?? 10,
    p_post_id: options.postId as string,
  });
  if (error) throw error;
  const outcomes: TargetOutcome[] = [];
  // 同じアカウントへの連続投稿で回数制限にかかりにくいよう、順に送る
  for (const t of data) outcomes.push(await publishOne(admin, t, deps));
  return outcomes;
}

// 送信済みの投稿を SNS 上で取り消す。呼ぶ前に、利用者本人の配信先であることを確かめておく
export async function deletePublishedTarget(admin: Admin, targetId: string, deps: PublisherDeps): Promise<void> {
  const { data: t, error } = await admin
    .from("post_targets")
    .select("id, sns, status, external_post_id, social_account_id, social_accounts(external_id, status)")
    .eq("id", targetId)
    .single();
  if (error) throw error;
  const label = isSnsKey(t.sns) ? SNS[t.sns].label : t.sns;
  const adapter = isSnsKey(t.sns) ? deps.adapters[t.sns] : undefined;
  if (t.status !== "published" || !t.external_post_id) throw new SnsPublishError("permanent", "送信済みの投稿ではありません。");
  if (!adapter) throw new SnsPublishError("permanent", `${label} の取り消しはまだ準備中です。`);
  const acc = t.social_accounts as unknown as { external_id: string; status: string } | null;
  if (!t.social_account_id || !acc || acc.status !== "active") {
    throw new SnsPublishError("auth", `${label} の接続が切れています。${RECONNECT}`);
  }
  const account = await loadAccount(admin, t.social_account_id, acc.external_id, deps, adapter);
  if (!account) throw new SnsPublishError("auth", `${label} の接続が切れています。${RECONNECT}`);

  try {
    await adapter.deletePost(account, t.external_post_id);
  } catch (e) {
    if (e instanceof SnsPublishError && e.kind === "auth") await markAccountExpired(admin, t.social_account_id);
    throw e;
  }
  const { error: updateError } = await admin.from("post_targets").update({ status: "deleted" }).eq("id", targetId);
  if (updateError) throw updateError;
}

export type RefreshOutcome = { socialAccountId: string; result: "refreshed" | "expired" | "failed" | "skipped"; message?: string };

// 期限が近いトークンを延長する（日次のジョブ）。延長は発行から 24 時間たったものだけができる
export async function refreshDueTokens(admin: Admin, deps: PublisherDeps): Promise<RefreshOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const { data, error } = await admin
    .from("social_account_tokens")
    .select("social_account_id, access_token_encrypted, expires_at, updated_at, social_accounts!inner(sns, status)")
    .eq("social_accounts.status", "active")
    .not("expires_at", "is", null);
  if (error) throw error;

  const outcomes: RefreshOutcome[] = [];
  for (const row of data) {
    const id = row.social_account_id;
    const acc = row.social_accounts as unknown as { sns: string; status: string };
    const adapter = isSnsKey(acc.sns) ? deps.adapters[acc.sns] : undefined;
    const expiresAt = new Date(row.expires_at!);

    // リフレッシュトークンで取り直す SNS（X）。アクセストークンは 2 時間で切れるが、送るときに取り直すのでここでは見ない。
    // 使われないままのリフレッシュトークンが古くならないよう、しばらく取り直していなければ新しくする
    if (adapter?.refreshWithRefreshToken && adapter.shouldRotate) {
      if (!adapter.shouldRotate(new Date(row.updated_at), now)) continue;
      try {
        const token = await refreshOnce(admin, id, adapter, deps, { force: true });
        outcomes.push({ socialAccountId: id, result: token ? "refreshed" : "expired" });
      } catch (e) {
        outcomes.push({ socialAccountId: id, result: "failed", message: e instanceof Error ? e.message : String(e) });
      }
      continue;
    }

    if (!adapter?.refreshToken || !adapter.shouldRefresh) continue;

    if (expiresAt <= now) {
      await markAccountExpired(admin, id);
      outcomes.push({ socialAccountId: id, result: "expired" });
      continue;
    }
    if (!adapter.shouldRefresh(expiresAt, now)) continue;
    if (now.getTime() - new Date(row.updated_at).getTime() < 24 * 60 * 60 * 1000) {
      outcomes.push({ socialAccountId: id, result: "skipped", message: "発行から 24 時間たっていません" });
      continue;
    }

    try {
      const token = decryptToken(row.access_token_encrypted, id, deps.key);
      const refreshed = await adapter.refreshToken(token, now);
      const { error: updateError } = await admin
        .from("social_account_tokens")
        .update({
          access_token_encrypted: encryptToken(refreshed.accessToken, id, deps.key),
          expires_at: refreshed.expiresAt.toISOString(),
        })
        .eq("social_account_id", id);
      if (updateError) throw updateError;
      outcomes.push({ socialAccountId: id, result: "refreshed" });
    } catch (e) {
      if (e instanceof SnsPublishError && e.kind === "auth") {
        await markAccountExpired(admin, id);
        outcomes.push({ socialAccountId: id, result: "expired", message: e.userMessage });
      } else {
        // 一時的な失敗なら翌日またやり直す（期限まで 30 日あるので間に合う）
        outcomes.push({ socialAccountId: id, result: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return outcomes;
}
