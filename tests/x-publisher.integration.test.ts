// X の送信（トークンの取り直しを 1 回だけにする・月の上限・費用の記録）と、その権限。
// X には偽のアダプターを使い、本物の X には送らない。取り出しは必ず postId を指定し、日時は未来にして pg_cron に拾われないようにする。
// 月の上限は本番では矢書全体の合計で決まる。同じ DB で他のテストが同時に流れても左右されないよう、
// 上限を確かめるテストは数える範囲を alice の記録だけにする（budgetScopeOwner）。全体で数えることは別のテストで確かめる
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { refreshTokenAad, saveConnectedAccount } from "@/lib/sns/accounts";
import { SnsPublishError, type SnsAdapter } from "@/lib/sns/adapters/types";
import { loadAccount, publishDueTargets, refreshDueTokens, type PublisherDeps } from "@/lib/sns/publisher";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let accountId: string;
let refreshCount = 0;

// 取り直すたびに新しいリフレッシュトークンを返し、古いものを使うと失敗する（X と同じ）偽物
function fakeX(overrides: Partial<SnsAdapter> = {}): SnsAdapter {
  let current = "refresh-1";
  return {
    sns: "x",
    publishText: vi.fn(async () => {
      const id = randomUUID();
      return { externalPostId: id, url: `https://x.com/i/web/status/${id}` };
    }),
    deletePost: vi.fn(async () => {}),
    refreshWithRefreshToken: vi.fn(async (refreshToken: string, now: Date) => {
      await new Promise((r) => setTimeout(r, 50));
      if (refreshToken !== current) throw new SnsPublishError("auth", "X の接続が切れています。");
      refreshCount += 1;
      current = `refresh-${refreshCount + 1}`;
      return { accessToken: `access-${refreshCount + 1}`, refreshToken: current, expiresAt: new Date(now.getTime() + 2 * 3600_000) };
    }),
    shouldRotate: (last: Date, now: Date) => now.getTime() - last.getTime() >= 30 * 86400_000,
    publishCost: (text: string) => (text.includes("https://") ? { operation: "post_with_url", costUsd: 0.2 } : { operation: "post", costUsd: 0.015 }),
    ...overrides,
  };
}

const deps = (adapter: SnsAdapter, budget?: number): PublisherDeps => ({
  adapters: { x: adapter },
  key,
  budgetsUsd: budget === undefined ? undefined : { x: budget },
  budgetScopeOwner: budget === undefined ? undefined : aliceId,
  refreshWait: { intervalMs: 50, tries: 40 },
});

async function connect(expiresAt: Date) {
  refreshCount = 0;
  accountId = await saveConnectedAccount(
    admin,
    {
      ownerId: aliceId,
      sns: "x",
      externalId: `x-${aliceId}`,
      displayName: "Alice",
      handle: "alice",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt,
      scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    },
    key,
  );
  await admin.from("project_social_accounts").upsert({ project_id: projectId, social_account_id: accountId, owner_id: aliceId });
}

async function scheduledPost(body: string): Promise<{ postId: string; targetId: string }> {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: body,
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: [{ sns: "x", social_account_id: accountId }],
  });
  if (error) throw error;
  const { data } = await admin.from("post_targets").select("id").eq("post_id", postId!).single();
  return { postId: postId!, targetId: data!.id };
}

// alice が今月 X に使った額（上限を数える範囲と同じ）
async function spentNow(): Promise<number> {
  const { data, error } = await admin.from("sns_api_usage").select("cost_usd").eq("sns", "x").eq("owner_id", aliceId).gte("created_at", monthStartJst());
  if (error) throw error;
  return data.reduce((sum, r) => sum + Number(r.cost_usd), 0);
}

function monthStartJst(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000).toISOString();
}

async function usageOf(targetId: string) {
  const { data } = await admin.from("sns_api_usage").select("operation, cost_usd").eq("post_target_id", targetId);
  return data!;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "A" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("トークンの取り直し", () => {
  it("アクセストークンが切れていたら、リフレッシュトークンで取り直してから送る", async () => {
    await connect(new Date(Date.now() - 60_000));
    const adapter = fakeX();
    const { postId } = await scheduledPost(`切れたトークン ${randomUUID()}`);
    const [outcome] = await publishDueTargets(admin, deps(adapter), { postId });
    expect(outcome.result).toBe("published");
    expect(adapter.refreshWithRefreshToken).toHaveBeenCalledTimes(1);
    expect(adapter.publishText).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "access-2" }), expect.any(String), []);

    const { data: row } = await admin.from("social_account_tokens").select("*").eq("social_account_id", accountId).single();
    expect(decryptToken(row!.refresh_token_encrypted!, refreshTokenAad(accountId), key)).toBe("refresh-2");
    expect(row!.refresh_locked_until).toBeNull();
  });

  it("同時に 3 か所から読んでも、取り直しは 1 回だけ（使い捨てのリフレッシュトークンを失効させない）", async () => {
    await connect(new Date(Date.now() - 60_000));
    const adapter = fakeX();
    const accounts = await Promise.all([1, 2, 3].map(() => loadAccount(admin, accountId, `x-${aliceId}`, deps(adapter), adapter)));
    expect(adapter.refreshWithRefreshToken).toHaveBeenCalledTimes(1);
    expect(accounts.map((a) => a?.accessToken)).toEqual(["access-2", "access-2", "access-2"]);
    const { data: acc } = await admin.from("social_accounts").select("status").eq("id", accountId).single();
    expect(acc!.status).toBe("active");
  });

  it("アクセストークンがまだ使えるなら、取り直さない", async () => {
    await connect(new Date(Date.now() + 3600_000));
    const adapter = fakeX();
    const account = await loadAccount(admin, accountId, `x-${aliceId}`, deps(adapter), adapter);
    expect(account?.accessToken).toBe("access-1");
    expect(adapter.refreshWithRefreshToken).not.toHaveBeenCalled();
  });

  it("リフレッシュトークンが使えなくなっていたら、アカウントを期限切れにする", async () => {
    await connect(new Date(Date.now() - 60_000));
    const adapter = fakeX({
      refreshWithRefreshToken: vi.fn(async () => {
        throw new SnsPublishError("auth", "X の接続が切れています。");
      }),
    });
    expect(await loadAccount(admin, accountId, `x-${aliceId}`, deps(adapter), adapter)).toBeNull();
    const { data: acc } = await admin.from("social_accounts").select("status").eq("id", accountId).single();
    expect(acc!.status).toBe("expired");
    const { data: row } = await admin.from("social_account_tokens").select("refresh_locked_until").eq("social_account_id", accountId).single();
    expect(row!.refresh_locked_until).toBeNull();
  });

  it("日次のジョブは、アクセストークンが切れていても期限切れにせず、30 日取り直していなければ新しくする", async () => {
    await connect(new Date(Date.now() - 60_000));
    const adapter = fakeX();
    // 共有のローカル DB で他の人のアカウントを偽物で延長しないよう、alice のアカウントだけを対象にする
    const today = await refreshDueTokens(admin, { ...deps(adapter), onlyOwner: aliceId });
    expect(today.find((o) => o.socialAccountId === accountId)).toBeUndefined();

    const later = new Date(Date.now() + 31 * 86400_000);
    const outcomes = await refreshDueTokens(admin, { ...deps(adapter), now: () => later, onlyOwner: aliceId });
    // alice 以外のアカウントは対象にしない
    expect(outcomes.every((o) => o.socialAccountId === accountId)).toBe(true);
    expect(outcomes.find((o) => o.socialAccountId === accountId)?.result).toBe("refreshed");
    expect(adapter.refreshWithRefreshToken).toHaveBeenCalledTimes(1);
  });
});

describe("費用と月の上限", () => {
  beforeAll(async () => {
    await connect(new Date(Date.now() + 3600_000));
  });

  it("送る前に費用を記録する（URL ありは $0.20）", async () => {
    const { postId, targetId } = await scheduledPost(`URL あり https://example.com/${randomUUID()}`);
    const [outcome] = await publishDueTargets(admin, deps(fakeX(), 1000), { postId });
    expect(outcome.result).toBe("published");
    expect(await usageOf(targetId)).toEqual([{ operation: "post_with_url", cost_usd: 0.2 }]);
  });

  it("上限を超えるなら送らず、要確認と手で投稿の案内を出す", async () => {
    const adapter = fakeX();
    const { postId, targetId } = await scheduledPost(`上限 ${randomUUID()}`);
    const [outcome] = await publishDueTargets(admin, deps(adapter, await spentNow()), { postId });
    expect(outcome.result).toBe("failed");
    expect(outcome.message).toContain("上限");
    expect(outcome.message).toContain("手で投稿");
    expect(adapter.publishText).not.toHaveBeenCalled();
    expect(await usageOf(targetId)).toEqual([]);
  });

  it("同時に送っても上限を超えない", async () => {
    const posts = await Promise.all([1, 2, 3].map(() => scheduledPost(`同時 ${randomUUID()}`)));
    const budget = (await spentNow()) + 0.015 * 2;
    const adapter = fakeX();
    const results = (await Promise.all(posts.map((p) => publishDueTargets(admin, deps(adapter, budget), { postId: p.postId })))).flat();
    // 上限は alice の記録だけで数える（budgetScopeOwner）ので、同じ DB でほかのテストやセッションが流れていても、ちょうど 2 本になる
    expect(results.filter((r) => r.result === "published")).toHaveLength(2);
    expect(results.filter((r) => r.result === "failed")).toHaveLength(1);
    expect(adapter.publishText).toHaveBeenCalledTimes(2);
    expect(await spentNow()).toBeCloseTo(budget, 6);
  });

  it("送れなかったと確かなとき（クレジット切れなど）は、費用の記録を消す", async () => {
    const adapter = fakeX({
      publishText: vi.fn(async () => {
        throw new SnsPublishError("permanent", "X の API の上限、またはクレジット切れで断られました。");
      }),
    });
    const { postId, targetId } = await scheduledPost(`クレジット切れ ${randomUUID()}`);
    const [outcome] = await publishDueTargets(admin, deps(adapter, 1000), { postId });
    expect(outcome.result).toBe("failed");
    expect(await usageOf(targetId)).toEqual([]);
  });

  it("投稿されたかわからないときは、費用の記録を残す", async () => {
    const adapter = fakeX({
      publishText: vi.fn(async () => {
        throw new SnsPublishError("unknown", "X への投稿の途中で通信が切れました。");
      }),
    });
    const { postId, targetId } = await scheduledPost(`通信切れ ${randomUUID()}`);
    await publishDueTargets(admin, deps(adapter, 1000), { postId });
    expect(await usageOf(targetId)).toEqual([{ operation: "post", cost_usd: 0.015 }]);
  });
});

describe("権限", () => {
  it("費用の記録は本人だけが読め、だれも書けない・消せない", async () => {
    const { data: mine } = await alice.from("sns_api_usage").select("id");
    expect(mine!.length).toBeGreaterThan(0);
    const { data: others } = await bob.from("sns_api_usage").select("id");
    expect(others).toEqual([]);

    const { error: insertError } = await alice.from("sns_api_usage").insert({ owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0 });
    expect(insertError).not.toBeNull();
    await alice.from("sns_api_usage").delete().eq("owner_id", aliceId);
    const { data: still } = await admin.from("sns_api_usage").select("id").eq("owner_id", aliceId);
    expect(still!.length).toBe(mine!.length);
  });

  it("範囲を指定しなければ（本番）、ほかの利用者の記録も合わせて矢書全体で数える", async () => {
    // bob の記録（$1）を足す。全体の合計は少なくとも alice の分 + $1 になる
    const { data: bobUsage } = await admin.from("sns_api_usage").insert({ owner_id: bobId, sns: "x", operation: "post", cost_usd: 1 }).select("id").single();
    const budget = (await spentNow()) + 0.5;
    const reserve = (scope: string | null) =>
      admin.rpc("reserve_sns_spend", {
        p_owner_id: aliceId,
        p_sns: "x",
        p_post_target_id: null as unknown as string,
        p_operation: "post",
        p_cost_usd: 0.015,
        p_budget_usd: budget,
        p_scope_owner: scope as string,
      });
    // 全体で数えると bob の $1 で上限を超える
    const global = await reserve(null);
    expect(global.error).toBeNull();
    expect(global.data).toBeNull();
    // alice の記録だけなら上限の中
    const scoped = await reserve(aliceId);
    expect(scoped.data).not.toBeNull();
    await admin.from("sns_api_usage").delete().in("id", [bobUsage!.id, scoped.data!]);
  });

  it("今月の費用の合計は DB で出し、利用者を指定するとその人の分だけになる", async () => {
    const { data: rows } = await admin
      .from("sns_api_usage")
      .insert([
        { owner_id: aliceId, sns: "x", operation: "post", cost_usd: 0.015 },
        { owner_id: bobId, sns: "x", operation: "post_with_url", cost_usd: 0.2 },
      ])
      .select("id");
    const mine = Number((await admin.rpc("sns_spend_this_month", { p_sns: "x", p_owner_id: aliceId })).data);
    const { data: aliceRows } = await admin.from("sns_api_usage").select("cost_usd").eq("owner_id", aliceId).eq("sns", "x");
    expect(mine).toBeCloseTo(aliceRows!.reduce((s, r) => s + Number(r.cost_usd), 0), 6);
    expect(Number((await admin.rpc("sns_spend_this_month", { p_sns: "x", p_owner_id: bobId })).data)).toBeCloseTo(0.2, 6);
    await admin.from("sns_api_usage").delete().in("id", rows!.map((r) => r.id));
  });

  it("費用の記録・合計・トークンの延長の関数は、ログインした利用者から呼べない", async () => {
    const reserve = await alice.rpc("reserve_sns_spend", {
      p_owner_id: aliceId,
      p_sns: "x",
      p_post_target_id: null as unknown as string,
      p_operation: "post",
      p_cost_usd: 0,
      p_budget_usd: 100,
    });
    expect(reserve.error).not.toBeNull();
    expect((await alice.rpc("sns_spend_this_month", { p_sns: "x" })).error).not.toBeNull();
    expect((await alice.rpc("claim_token_refresh", { p_social_account_id: accountId })).error).not.toBeNull();
  });

  it("送れなかった X の配信先は、本人が手で投稿して記録できる。ほかの人や、送る前のものはできない", async () => {
    const { postId, targetId } = await scheduledPost(`手で投稿 ${randomUUID()}`);
    const pending = await alice.rpc("mark_manual_target_posted", { p_target_id: targetId, p_url: "https://x.com/alice/status/1" });
    expect(pending.error).not.toBeNull();

    await publishDueTargets(admin, deps(fakeX(), 0), { postId });
    const byBob = await bob.rpc("mark_manual_target_posted", { p_target_id: targetId, p_url: "" });
    expect(byBob.error).not.toBeNull();

    const byAlice = await alice.rpc("mark_manual_target_posted", { p_target_id: targetId, p_url: "https://x.com/alice/status/1" });
    expect(byAlice.error).toBeNull();
    const { data } = await admin.from("post_targets").select("status, external_url, external_post_id").eq("id", targetId).single();
    expect(data).toEqual({ status: "published", external_url: "https://x.com/alice/status/1", external_post_id: null });
  });
});
