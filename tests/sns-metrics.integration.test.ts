// SNS の数字の取り込み（docs/architecture.md の 4.22、F07 の段取り ④）。数字は偽物の読み方で返し、本物の SNS は呼ばない。
// 取り込みは必ずテストの利用者に絞る
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runSnsMetricsImport } from "@/lib/metrics/sns-import";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { InsightsFetcher } from "@/lib/sns/insights";
import { anonClient, adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(NOW);

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let withScope: string;
let withoutScope: string;

function fakeFetcher(views: number): InsightsFetcher {
  return { post: vi.fn(async () => ({ views, likes: 3 })), account: vi.fn(async () => ({ followers: 50 })) };
}

async function publishedTarget(sns: "threads" | "instagram" | "x", accountId: string, publishedAt: string) {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: `${sns} の投稿`,
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns, social_account_id: accountId }],
  });
  if (error) throw error;
  const { data } = await admin
    .from("post_targets")
    .update({ status: "published", published_at: publishedAt, external_post_id: `ext-${randomUUID()}` })
    .eq("post_id", postId!)
    .select("id")
    .single();
  return { postId: postId!, targetId: data!.id };
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "SNS の数字" }).select("id").single()).data!.id;
  const account = (sns: "threads" | "instagram", scopes: string[]) =>
    saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns, externalId: `${sns}-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes },
      key,
    );
  withScope = await account("threads", ["threads_basic", "threads_manage_insights"]);
  withoutScope = await account("instagram", ["instagram_business_basic"]);
  await alice.from("project_social_accounts").insert([
    { project_id: projectId, social_account_id: withScope },
    { project_id: projectId, social_account_id: withoutScope },
  ]);
});

afterAll(async () => {
  await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("取り込み", () => {
  it("権限つきのアカウントの、時期が来た投稿だけを読む。権限なし・時期でないものは読まない。2 回目は読まない", async () => {
    const due = await publishedTarget("threads", withScope, daysAgo(1.5));
    await publishedTarget("threads", withScope, daysAgo(0.5)); // 1 日たっていない
    await publishedTarget("threads", withScope, daysAgo(40)); // 30 日目の期限も過ぎた
    await publishedTarget("instagram", withoutScope, daysAgo(2.5)); // 権限なし
    const threads = fakeFetcher(300);
    const instagram = fakeFetcher(999);
    const deps = { fetchers: { threads, instagram }, key, ownerId: aliceId, insightsEnv: "threads,instagram", now: () => NOW };

    const outcomes = await runSnsMetricsImport(admin, deps);
    expect(outcomes.filter((o) => o.kind === "post" && o.result === "saved").map((o) => o.id)).toEqual([due.targetId]);
    expect(instagram.post).not.toHaveBeenCalled();
    const { data } = await alice.from("post_metrics").select("day_index, values").eq("post_target_id", due.targetId);
    expect(data).toEqual([{ day_index: 1, values: { views: 300, likes: 3 } }]);

    // アカウントの数字（フォロワー）も、権限つきのものだけ
    expect(threads.account).toHaveBeenCalledTimes(1);
    expect(instagram.account).not.toHaveBeenCalled();

    const again = await runSnsMetricsImport(admin, deps);
    expect(again.filter((o) => o.result === "saved")).toEqual([]);
  });

  it("SNS_INSIGHTS で有効にしていない SNS は、権限つきでも読まない", async () => {
    await publishedTarget("threads", withScope, daysAgo(3.2));
    const threads = fakeFetcher(10);
    await runSnsMetricsImport(admin, { fetchers: { threads }, key, ownerId: aliceId, insightsEnv: "", now: () => NOW });
    expect(threads.post).not.toHaveBeenCalled();
  });

  it("数字の画面の合計: 閲覧数・フォロワー・よく見られた投稿。他人は読めない", async () => {
    const { data } = await alice.rpc("sns_weekly_totals", { p_project_id: projectId, p_today: today() });
    expect(data![0]).toMatchObject({ views_this_week: 300, followers_now: 50, has_post_metrics: true, has_account_metrics: true });
    const { data: top } = await alice.rpc("top_posts_by_views", { p_project_id: projectId, p_today: today(), p_days: 30, p_limit: 5 });
    expect(top).toHaveLength(1);
    expect(top![0].views).toBe(300);
    expect((await bob.from("post_metrics").select("*").limit(5)).data).toEqual([]);
    expect((await bob.from("account_metrics").select("*").limit(5)).data).toEqual([]);
    expect((await bob.rpc("sns_weekly_totals", { p_project_id: projectId, p_today: today() })).data![0]).toMatchObject({ has_post_metrics: false });
    expect((await anonClient().from("post_metrics").select("*").limit(1)).error?.code).toBe("42501");
    expect((await alice.rpc("due_post_metric_targets", {})).error?.code).toBe("42501");
  });
});

describe("X の数字（読むたびに費用がかかる）", () => {
  let xAccount: string;
  beforeAll(async () => {
    xAccount = await saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns: "x", externalId: `x-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: ["tweet.read", "users.read"] },
      key,
    );
    await alice.from("project_social_accounts").insert({ project_id: projectId, social_account_id: xAccount });
  });

  // 上限を数える範囲はこの利用者だけにする（ほかのテストや本当の利用者の費用と混ざらないように）
  const xDeps = (x: InsightsFetcher, userBudgetUsd: number) => ({
    fetchers: { x },
    key,
    ownerId: aliceId,
    insightsEnv: "x",
    now: () => NOW,
    x: { budgetUsd: 3, userBudgetUsd, scopeOwner: aliceId },
  });
  const usage = async () => (await admin.from("sns_api_usage").select("operation, cost_usd").eq("owner_id", aliceId).eq("sns", "x").order("created_at")).data ?? [];

  it("読む前に費用を記録し、利用者ごとの月の上限を超える分は読まない（フォロワーも）", async () => {
    for (let i = 0; i < 3; i++) await publishedTarget("x", xAccount, daysAgo(1.2 + i * 0.1));
    const x = fakeFetcher(40);
    // 投稿 2 件分（$0.010）だけ読める上限
    const outcomes = await runSnsMetricsImport(admin, xDeps(x, 0.012));
    const xs = outcomes.filter((o) => o.sns === "x");
    expect(xs.filter((o) => o.kind === "post" && o.result === "saved")).toHaveLength(2);
    expect(xs.filter((o) => o.result === "skipped").map((o) => o.message)).toEqual(["X の数字の月の上限に達した", "X の数字の月の上限に達した"]);
    expect(x.post).toHaveBeenCalledTimes(2);
    expect(x.account).not.toHaveBeenCalled();
    expect(await usage()).toEqual([
      { operation: "metrics_read", cost_usd: 0.005 },
      { operation: "metrics_read", cost_usd: 0.005 },
    ]);
    // 本人だけが、今月の X の数字の費用を読める（指標の画面の「上限に達しました」のため）
    expect(Number((await alice.rpc("my_x_metrics_spend_this_month")).data)).toBeCloseTo(0.01);
    expect(Number((await bob.rpc("my_x_metrics_spend_this_month")).data)).toBe(0);
    expect((await alice.rpc("reserve_x_metrics_read", { p_owner_id: aliceId, p_post_target_id: null as unknown as string, p_operation: "metrics_read", p_cost_usd: 0, p_budget_usd: 100, p_user_budget_usd: 100 })).error?.code).toBe("42501");
  });

  it("上限に余裕があれば残りとフォロワー（$0.010）を読む。読めなかった分は費用の記録を消す", async () => {
    const x: InsightsFetcher = { post: vi.fn(async () => Promise.reject(new Error("X の障害"))), account: vi.fn(async () => ({ followers: 12 })) };
    const outcomes = await runSnsMetricsImport(admin, xDeps(x, 1));
    const xs = outcomes.filter((o) => o.sns === "x");
    expect(xs.find((o) => o.kind === "post")).toMatchObject({ result: "failed" });
    expect(xs.find((o) => o.kind === "account")).toMatchObject({ result: "saved" });
    expect((await usage()).map((u) => u.operation)).toEqual(["metrics_read", "metrics_read", "followers_read"]);
    // フォロワーは 7 日に 1 回なので、次の日は読まない
    const next = await runSnsMetricsImport(admin, { ...xDeps(x, 1), now: () => new Date(NOW.getTime() + 86_400_000) });
    expect(next.filter((o) => o.sns === "x" && o.kind === "account")).toEqual([]);
  });

  it("X の上限を渡さない（設定がない）ときは、X に費用をかけない", async () => {
    await publishedTarget("x", xAccount, daysAgo(1.1));
    const x = fakeFetcher(1);
    await runSnsMetricsImport(admin, { fetchers: { x }, key, ownerId: aliceId, insightsEnv: "x", now: () => NOW });
    expect(x.post).not.toHaveBeenCalled();
  });
});
