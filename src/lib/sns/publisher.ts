import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import { lacksImageScope } from "@/lib/media/rules";
import { publishImagesFor } from "@/lib/media/store";
import { refreshTokenAad } from "./accounts";
import { isSnsKey, SNS, type SnsKey } from "@/lib/sns";
import type { Database, Json } from "@/lib/supabase/database.types";
import { SnsPublishError, type AdapterAccount, type PrepareState, type PublishImage, type PublishResult, type RefreshedTokens, type SnsAdapter } from "./adapters/types";

// 送信ジョブの本体。RLS を通らないクライアント（createAdminClient）で呼ぶ。方針は docs/architecture.md の 4.7
type Admin = SupabaseClient<Database>;
type Adapters = Partial<Record<SnsKey, SnsAdapter>>;
export type PublisherDeps = {
  adapters: Adapters;
  key?: Buffer;
  now?: () => Date;
  // 使った分だけ払う SNS の、月の上限（米ドル、矢書全体）。ない SNS は上限なし
  budgetsUsd?: Partial<Record<SnsKey, number>>;
  // 上限を数える範囲。ないときは矢書全体（本番）。利用者の ID を入れると、その人の記録だけを数える（テストで他のテストに左右されないため）
  budgetScopeOwner?: string;
  // 日次のトークン延長の対象を、この利用者のアカウントだけにする（テスト用。共有のローカル DB で、他の人のアカウントを偽物で延長しないため）。本番は渡さない
  onlyOwner?: string;
  // 延長をほかの処理が行っているとき、待つ間隔と回数（テストで短くする）
  refreshWait?: { intervalMs: number; tries: number };
  // 日次のジョブで一度に読む件数（テストで小さくして、少しずつ読んでも漏れないことを確かめる）。本番は REFRESH_PAGE_SIZE
  refreshPageSize?: number;
  // 投稿の画像を読む（テストで差し替える）。既定は Storage から読み、署名 URL を作る
  loadImages?: (admin: Admin, postId: string) => Promise<PublishImage[]>;
};

// 1 つの配信先につき最大 3 回まで試す。2 回目は 1 分後、3 回目は 5 分後
export const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

export function retryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[attempts - 1] ?? null;
}

export type ClaimedTarget = Database["public"]["Functions"]["claim_due_targets"]["Returns"][number];
// preparing: SNS 側で画像を準備中（次の回に続きを確かめる） / deferred: この回の時間が足りず、次の回に回した
export type TargetOutcome = {
  targetId: string;
  postId: string;
  sns: string;
  result: "published" | "retry" | "failed" | "preparing" | "deferred";
  message?: string;
};

// 1 回の送信ジョブで使ってよい時間。ジョブの上限（60 秒、src/app/api/jobs/publish/route.ts）より短くし、残りで後片付けをする
export const JOB_DEADLINE_MS = 40_000;
// 準備中の続きを確かめる間隔。予約ジョブは毎分動くので、実際には次の回になる
export const PREPARE_CHECK_DELAY_MS = 15_000;
// 準備を始めてからこれだけたっても公開できなければ、最初からやり直す（コンテナは作り直す）
export const PREPARE_TIMEOUT_MS = 15 * 60_000;

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

async function tokenScopes(admin: Admin, socialAccountId: string): Promise<string[]> {
  const { data, error } = await admin.from("social_account_tokens").select("scopes").eq("social_account_id", socialAccountId).maybeSingle();
  if (error) throw error;
  return data?.scopes ?? [];
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
  scopeOwner: string | null,
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
    p_scope_owner: scopeOwner as string,
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
      .update({ status: "failed", error_message: message, locked_at: null, next_attempt_at: null, sns_container: null, preparing_since: null })
      .eq("id", t.target_id);
    if (error) throw error;
    return { ...base, result: "failed", message };
  };

  const adapter = isSnsKey(t.sns) ? deps.adapters[t.sns] : undefined;
  const label = isSnsKey(t.sns) ? SNS[t.sns].label : t.sns;
  if (!adapter) return fail(`${label} への送信はまだ準備中です。`);
  if (!t.social_account_id || !t.account_external_id) return fail(`${label} のアカウントがつながっていません。${RECONNECT}`);
  if (t.account_status !== "active") return fail(`${label} の接続が切れています。${RECONNECT}`);

  const published = async (result: PublishResult): Promise<TargetOutcome> => {
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
        sns_container: null,
        preparing_since: null,
      })
      .eq("id", t.target_id);
    if (error) throw error;
    return { ...base, result: "published" };
  };

  // SNS 側で画像を準備中。状態を記録し、次の回（1 分後）に続きを確かめる
  const preparing = async (state: PrepareState, since: string): Promise<TargetOutcome> => {
    const { error } = await admin
      .from("post_targets")
      .update({
        status: "preparing",
        sns_container: state as Json,
        preparing_since: since,
        error_message: null,
        locked_at: null,
        next_attempt_at: new Date(now.getTime() + PREPARE_CHECK_DELAY_MS).toISOString(),
      })
      .eq("id", t.target_id);
    if (error) throw error;
    return { ...base, result: "preparing" };
  };

  // 使った分だけ払う SNS は、送る前に費用を記録する（月の上限を超えるなら送らない）。送れなかったと確かなときは記録を消す
  let usageId: string | null = null;
  try {
    const account = await loadAccount(admin, t.social_account_id, t.account_external_id, deps, adapter);
    if (!account) return fail(`${label} の接続が切れています。${RECONNECT}`);

    // 準備中の続き（前の回に startPublish 済み）。費用の記録や画像の読み込みはもう済んでいる
    if (t.sns_container && adapter.continuePublish) {
      const since = t.preparing_since ?? now.toISOString();
      if (now.getTime() - new Date(since).getTime() > PREPARE_TIMEOUT_MS) {
        throw new SnsPublishError("retryable", `${label} 側の画像の準備に時間がかかっています。最初から送り直します。`);
      }
      const next = await adapter.continuePublish(account, t.sns_container as PrepareState);
      return "done" in next ? published(next.done) : preparing(next.state, since);
    }

    // 投稿の画像（docs/architecture.md の 4.18）。画像を送らない SNS（動画だけ・手で投稿）には渡さない
    let images: PublishImage[] = [];
    if (isSnsKey(t.sns) && SNS[t.sns].maxImages > 0) {
      images = await (deps.loadImages ?? publishImagesFor)(admin, t.post_id);
      if (images.length > SNS[t.sns].maxImages) {
        return fail(`${label} に添えられる画像は ${SNS[t.sns].maxImages} 枚までです。投稿の画面で画像を減らしてから送り直してください。`);
      }
      if (images.length && lacksImageScope(t.sns, await tokenScopes(admin, t.social_account_id))) {
        return fail(`${label} に画像を送るには、画像を送る権限を足すためのつなぎ直しが要ります。${RECONNECT}`);
      }
    }

    if (adapter.publishCost && isSnsKey(t.sns)) {
      const cost = adapter.publishCost(t.body, images);
      const budget = deps.budgetsUsd?.[t.sns];
      usageId = await reserveSpend(admin, t.target_id, t.sns, cost.operation, cost.costUsd, budget ?? null, deps.budgetScopeOwner ?? null);
      if (!usageId) {
        return fail(
          `今月の ${label} の上限（$${budget}）に達しました。来月まで自動では送りません。送信の結果から、手で投稿して記録できます。`,
        );
      }
    }

    // 画像の準備に時間がかかる SNS は、コンテナを作るだけで待たない。すぐ準備できていれば、この回で公開まで進める
    if (images.length > 0 && adapter.startPublish && adapter.continuePublish) {
      const state = await adapter.startPublish(account, t.body, images);
      const next = await adapter.continuePublish(account, state);
      return "done" in next ? published(next.done) : preparing(next.state, now.toISOString());
    }

    return published(await adapter.publishText(account, t.body, images));
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
          // 準備の途中だったものは、やり直すときにコンテナから作り直す
          sns_container: null,
          preparing_since: null,
        })
        .eq("id", t.target_id);
      if (error) throw error;
      return { ...base, result: "retry", message: err.userMessage };
    }
    return fail(err.userMessage);
  }
}

// 送る時刻が来た配信先を取り出して送る。postId を渡すとその投稿だけ（「今すぐ送る」）
// deadlineMs: この回で使ってよい時間。過ぎたら、取り出したまま送っていない配信先を元に戻し、次の回に回す
export async function publishDueTargets(
  admin: Admin,
  deps: PublisherDeps,
  options: { limit?: number; postId?: string; deadlineMs?: number } = {},
): Promise<TargetOutcome[]> {
  const startedAt = Date.now();
  const deadline = options.deadlineMs ?? JOB_DEADLINE_MS;
  const { data, error } = await admin.rpc("claim_due_targets", {
    p_limit: options.limit ?? 10,
    p_post_id: options.postId as string,
  });
  if (error) throw error;
  const outcomes: TargetOutcome[] = [];
  // 同じアカウントへの連続投稿で回数制限にかかりにくいよう、順に送る
  for (const t of data) {
    if (Date.now() - startedAt > deadline) {
      outcomes.push(await deferTarget(admin, t));
      continue;
    }
    outcomes.push(await publishOne(admin, t, deps));
  }
  return outcomes;
}

// 取り出したが、この回では送らない配信先を元の状態に戻す（試した回数も戻す）。次の回の取り出しで先に拾われる
async function deferTarget(admin: Admin, t: ClaimedTarget): Promise<TargetOutcome> {
  const resumed = Boolean(t.sns_container);
  const { error } = await admin
    .from("post_targets")
    .update({ status: resumed ? "preparing" : "pending", locked_at: null, attempts: resumed ? t.attempts : Math.max(0, t.attempts - 1) })
    .eq("id", t.target_id);
  if (error) throw error;
  return { targetId: t.target_id, postId: t.post_id, sns: t.sns, result: "deferred" };
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

// 日次のジョブで、トークンを一度に読む件数
export const REFRESH_PAGE_SIZE = 500;

export type RefreshOutcome = { socialAccountId: string; result: "refreshed" | "expired" | "failed" | "skipped"; message?: string };

// 期限が近いトークンを延長する（日次のジョブ）。延長は発行から 24 時間たったものだけができる
export async function refreshDueTokens(admin: Admin, deps: PublisherDeps): Promise<RefreshOutcome[]> {
  const now = deps.now?.() ?? new Date();
  // Supabase の API は 1 回に 1,000 行までしか返さないので、ID の順に少しずつ読む。
  // 途中で「期限切れ」にした行は条件から外れるので、件数で飛ばす（offset）のではなく、最後に読んだ ID の続きから読む
  const pageSize = deps.refreshPageSize ?? REFRESH_PAGE_SIZE;
  const rows = [];
  for (let after: string | null = null; ; ) {
    let query = admin
      .from("social_account_tokens")
      .select("social_account_id, access_token_encrypted, expires_at, updated_at, social_accounts!inner(sns, status, owner_id)")
      .eq("social_accounts.status", "active")
      .not("expires_at", "is", null)
      .order("social_account_id")
      .limit(pageSize);
    if (deps.onlyOwner) query = query.eq("social_accounts.owner_id", deps.onlyOwner);
    if (after) query = query.gt("social_account_id", after);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
    after = data[data.length - 1].social_account_id;
  }

  const outcomes: RefreshOutcome[] = [];
  for (const row of rows) {
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
