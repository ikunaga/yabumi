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
  const { data, error: updateError } = await admin
    .from("post_targets")
    .update({ status: "published", published_at: publishedAt, external_post_id: `ext-${randomUUID()}` })
    .eq("post_id", postId!)
    .select("id")
    .single();
  if (updateError) throw updateError;
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
    expect((await alice.rpc("due_post_metric_targets", { p_insights: {} })).error?.code).toBe("42501");
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
    // 3 件目は読む直前の確かめ（ロックの中）で止まる。フォロワー（$0.010）は上限に収まらないので、時期の関数が先に除く
    expect(xs.filter((o) => o.result === "skipped").map((o) => o.message)).toEqual(["X の数字の月の上限に達した"]);
    expect(xs.filter((o) => o.kind === "account")).toEqual([]);
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

describe("読めないものが溜まっても、後ろの読めるものに手が届く", () => {
  it("権限なし・X の上限に達した投稿が件数の上限より多くても、それより新しい読める投稿を読む", async () => {
    // それまでのテストで時期が来ている読める投稿を、先に読んでおく
    await runSnsMetricsImport(admin, { fetchers: { threads: fakeFetcher(1) }, key, ownerId: aliceId, insightsEnv: "threads", now: () => NOW });
    const xAccount = (await admin.from("social_accounts").select("id").eq("owner_id", aliceId).eq("sns", "x").single()).data!.id;
    // 古い順に並べると先に来る、読めない投稿（権限なしの Instagram 3 件、上限に達した X 3 件）
    for (let i = 0; i < 3; i++) await publishedTarget("instagram", withoutScope, daysAgo(2.9 - i * 0.01));
    for (let i = 0; i < 3; i++) await publishedTarget("x", xAccount, daysAgo(1.9 - i * 0.01));
    const readable = await publishedTarget("threads", withScope, daysAgo(1.05));
    const threads = fakeFetcher(7);
    const instagram = fakeFetcher(7);
    const x = fakeFetcher(7);
    const outcomes = await runSnsMetricsImport(admin, {
      fetchers: { threads, instagram, x },
      key,
      ownerId: aliceId,
      insightsEnv: "threads,instagram,x",
      now: () => NOW,
      limit: 2,
      x: { budgetUsd: 3, userBudgetUsd: 0, scopeOwner: aliceId },
    });
    expect(outcomes.filter((o) => o.kind === "post")).toEqual([{ kind: "post", id: readable.targetId, sns: "threads", result: "saved" }]);
    expect(instagram.post).not.toHaveBeenCalled();
    expect(x.post).not.toHaveBeenCalled();
  });
});

// 時刻を進めて読むので、ほかのテストの配信先も読み直す。合計を見るテストに響かないよう、いちばん後ろに置く
describe("最初の 7 日の読み直し（2026-11-28）", () => {
  it("最初の 7 日は毎朝読み直す。1 日目に 0 が返っても、次の日に増えた値が最新になる（2026-11-28 本番）", async () => {
    const t = await publishedTarget("threads", withScope, daysAgo(1.2));
    let views = 0;
    const threads: InsightsFetcher = { post: vi.fn(async () => ({ views, likes: views ? 2 : 0 })), account: vi.fn(async () => ({ followers: 50 })) };
    const run = (at: Date) => runSnsMetricsImport(admin, { fetchers: { threads }, key, ownerId: aliceId, insightsEnv: "threads", now: () => at });
    await run(NOW);
    // 同じ日のうちは読み直さない
    await run(new Date(NOW.getTime() + 3_600_000));
    views = 120;
    await run(new Date(NOW.getTime() + 86_400_000));
    const { data } = await alice.from("post_metrics").select("day_index, values").eq("post_target_id", t.targetId).order("day_index");
    expect(data).toEqual([
      { day_index: 1, values: { views: 0, likes: 0 } },
      { day_index: 2, values: { views: 120, likes: 2 } },
    ]);
    // 画面（numbers.ts など）は day_index がいちばん大きい行を使うので、120 が出る。あとのテストの合計に入らないよう消す
    await admin.from("posts").delete().eq("id", t.postId);
  });

  it("読む日を何日か逃しても、1 回の呼び出しで 1 つの配信先は 1 回だけ、いちばん新しい日の分を読む", async () => {
    const t = await publishedTarget("threads", withScope, daysAgo(4.5));
    const threads = fakeFetcher(40);
    await runSnsMetricsImport(admin, { fetchers: { threads }, key, ownerId: aliceId, insightsEnv: "threads", now: () => NOW });
    const { data } = await alice.from("post_metrics").select("day_index").eq("post_target_id", t.targetId);
    expect(data).toEqual([{ day_index: 4 }]);
    await admin.from("posts").delete().eq("id", t.postId);
  });

  it("時期の関数は、利用者と匿名からは呼べない（ジョブだけ）", async () => {
    const args = { p_insights: { threads: "threads_manage_insights" }, p_now: NOW.toISOString() };
    expect((await alice.rpc("due_post_metric_targets", args)).error?.code).toBe("42501");
    expect((await anonClient().rpc("due_post_metric_targets", args)).error?.code).toBe("42501");
  });
});
