// X の規約への対応: X で消された投稿の記録を最新に保つ（docs/architecture.md の 4.19）。
// 本物の X は呼ばない（読み取りは偽物を渡す）。上限は alice の記録だけで数え、同じ DB の他のテストに左右されないようにする
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { syncXTargetsOfPost, X_MAX_READS_PER_USER_PER_DAY, X_POST_READ_USD, type PostState, type SyncDeps } from "@/lib/sns/x/sync";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const HOUR = 3600_000;

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let accountId: string;

const adapter: SnsAdapter = {
  sns: "x",
  publishText: vi.fn(),
  deletePost: vi.fn(),
  // アクセストークンが切れていたら取り直す（25 時間後のテスト）
  refreshWithRefreshToken: vi.fn(async (_refresh: string, now: Date) => ({ accessToken: "access-2", refreshToken: "refresh-2", expiresAt: new Date(now.getTime() + 2 * HOUR) })),
};

function deps(readPost: SyncDeps["readPost"], budgetUsd: number | null = 1000, now = new Date()): SyncDeps {
  // トークンは差し替える。同じ DB で他のテストが日次のジョブを流すと、テストのアカウントが「期限切れ」にされることがあるため
  return { publisher: { key, now: () => now }, adapter, budgetUsd, budgetScopeOwner: aliceId, readPost, loadToken: async () => "access-1" };
}

// 送信済みの X の配信先を作る（送信の状態は利用者が書けないので、サーバーの権限で入れる）
async function publishedTarget(over: { externalPostId?: string | null; externalUrl?: string | null; publishedAt?: Date; checkedAt?: Date | null } = {}) {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: `送った ${randomUUID()}`,
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns: "x", social_account_id: accountId }],
  });
  if (error) throw error;
  const id = over.externalPostId === undefined ? String(Date.now()) + String(Math.floor(Math.random() * 1000)) : over.externalPostId;
  const { data: t, error: updateError } = await admin
    .from("post_targets")
    .update({
      status: "published",
      external_post_id: id,
      external_url: over.externalUrl === undefined ? (id ? `https://x.com/i/web/status/${id}` : null) : over.externalUrl,
      published_at: (over.publishedAt ?? new Date(Date.now() - 2 * HOUR)).toISOString(),
      sns_checked_at: over.checkedAt ? over.checkedAt.toISOString() : null,
    })
    .eq("post_id", postId!)
    .select("id")
    .single();
  if (updateError) throw updateError;
  return { postId: postId!, targetId: t!.id };
}

async function targetRow(targetId: string) {
  const { data } = await admin.from("post_targets").select("status, external_post_id, external_url, sns_removed_at, sns_checked_at").eq("id", targetId).single();
  return data!;
}

// alice が今日（日本時間）X の投稿を読んだ回数
async function readsToday() {
  const jst = new Date(Date.now() + 9 * HOUR);
  const dayStart = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * HOUR).toISOString();
  const { count } = await admin.from("sns_api_usage").select("id", { count: "exact", head: true }).eq("owner_id", aliceId).eq("operation", "post_read").gte("created_at", dayStart);
  return count ?? 0;
}

async function reads(targetId: string) {
  const { data } = await admin.from("sns_api_usage").select("operation, cost_usd").eq("post_target_id", targetId);
  return data!;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "A" }).select("id").single()).data!.id;
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
      expiresAt: new Date(Date.now() + 2 * HOUR),
      scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    },
    key,
  );
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("X で消された投稿の記録", () => {
  it("X で消されていたら、取り消し済みにして投稿の ID と URL を消す。読んだ費用（$0.005）を記録する", async () => {
    const { postId, targetId } = await publishedTarget({ externalPostId: "1111" });
    const readPost = vi.fn(async (): Promise<PostState> => "removed");
    const [outcome] = await syncXTargetsOfPost(admin, deps(readPost), postId);
    expect(outcome.result).toBe("removed");
    expect(readPost).toHaveBeenCalledWith("access-1", "1111");
    expect(await targetRow(targetId)).toMatchObject({ status: "deleted", external_post_id: null, external_url: null });
    expect((await targetRow(targetId)).sns_removed_at).not.toBeNull();
    expect(await reads(targetId)).toEqual([{ operation: "post_read", cost_usd: X_POST_READ_USD }]);
  });

  it("まだあれば確かめた日時だけを入れ、24 時間は確かめ直さない", async () => {
    const { postId, targetId } = await publishedTarget();
    const readPost = vi.fn(async (): Promise<PostState> => "exists");
    // 失敗したときに中身が見えるよう、結果をそのまま比べる
    expect(await syncXTargetsOfPost(admin, deps(readPost), postId)).toEqual([{ targetId, result: "exists" }]);
    expect((await targetRow(targetId)).status).toBe("published");
    expect((await targetRow(targetId)).sns_checked_at).not.toBeNull();
    expect(await syncXTargetsOfPost(admin, deps(readPost), postId)).toEqual([{ targetId, result: "skipped" }]);
    expect(readPost).toHaveBeenCalledTimes(1);
    // 25 時間たてば、また確かめる
    expect(await syncXTargetsOfPost(admin, deps(readPost, 1000, new Date(Date.now() + 25 * HOUR)), postId)).toEqual([{ targetId, result: "exists" }]);
    expect(readPost).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("送ってすぐ（10 分以内）は確かめない", async () => {
    const { postId } = await publishedTarget({ publishedAt: new Date(Date.now() - 60_000) });
    const readPost = vi.fn(async (): Promise<PostState> => "exists");
    expect((await syncXTargetsOfPost(admin, deps(readPost), postId))[0].result).toBe("skipped");
    expect(readPost).not.toHaveBeenCalled();
  });

  it("X の月の上限に達していたら、読まない（費用も記録しない）", async () => {
    const { postId, targetId } = await publishedTarget();
    const readPost = vi.fn(async (): Promise<PostState> => "exists");
    expect((await syncXTargetsOfPost(admin, deps(readPost, 0), postId))[0].result).toBe("skipped");
    expect(readPost).not.toHaveBeenCalled();
    expect(await reads(targetId)).toEqual([]);
  });

  it(`1 人が 1 日に確かめられるのは ${X_MAX_READS_PER_USER_PER_DAY} 回まで（共有の上限をほかの人の投稿のために残す）`, async () => {
    const { data: ins } = await admin
      .from("sns_api_usage")
      .insert(Array.from({ length: X_MAX_READS_PER_USER_PER_DAY - (await readsToday()) }, () => ({ owner_id: aliceId, sns: "x" as const, operation: "post_read", cost_usd: 0 })))
      .select("id");
    const { postId } = await publishedTarget();
    const readPost = vi.fn(async (): Promise<PostState> => "exists");
    expect((await syncXTargetsOfPost(admin, deps(readPost), postId))[0].result).toBe("skipped");
    expect(readPost).not.toHaveBeenCalled();
    await admin.from("sns_api_usage").delete().in("id", ins!.map((r) => r.id));
  });

  it("同時に開かれても、1 日の回数の上限を超えない", async () => {
    // 残りがちょうど 1 回になるようにする（このファイルの前のテストで読んだ分も数える）
    const left = X_MAX_READS_PER_USER_PER_DAY - (await readsToday());
    const { data: ins } = await admin
      .from("sns_api_usage")
      .insert(Array.from({ length: left - 1 }, () => ({ owner_id: aliceId, sns: "x" as const, operation: "post_read", cost_usd: 0 })))
      .select("id");
    const posts = await Promise.all([1, 2, 3, 4].map(() => publishedTarget()));
    const readPost = vi.fn(async (): Promise<PostState> => "exists");
    const outcomes = (await Promise.all(posts.map((p) => syncXTargetsOfPost(admin, deps(readPost), p.postId)))).flat();
    expect(outcomes.filter((o) => o.result === "exists")).toHaveLength(1);
    expect(readPost).toHaveBeenCalledTimes(1);
    await admin.from("sns_api_usage").delete().in("id", ins!.map((r) => r.id));
    await admin.from("sns_api_usage").delete().in("post_target_id", posts.map((p) => p.targetId));
  });

  it("読めなかったときは、費用の記録を消して、次に開いたときにまた確かめる", async () => {
    const { postId, targetId } = await publishedTarget();
    const readPost = vi.fn(async (): Promise<PostState> => {
      throw new Error("503");
    });
    expect((await syncXTargetsOfPost(admin, deps(readPost), postId))[0].result).toBe("skipped");
    expect(await reads(targetId)).toEqual([]);
    expect((await targetRow(targetId)).sns_checked_at).toBeNull();
  });

  it("手で投稿して記録したものは、URL から ID を取って確かめる", async () => {
    const { postId } = await publishedTarget({ externalPostId: null, externalUrl: "https://x.com/alice/status/2222?s=20" });
    const readPost = vi.fn(async (): Promise<PostState> => "exists");
    await syncXTargetsOfPost(admin, deps(readPost), postId);
    expect(readPost).toHaveBeenCalledWith("access-1", "2222");
  });

  it("取り消し済みになったら、どの経路でも投稿の ID と URL は残らない", async () => {
    const { targetId } = await publishedTarget({ externalPostId: "3333" });
    await admin.from("post_targets").update({ status: "deleted" }).eq("id", targetId);
    expect(await targetRow(targetId)).toMatchObject({ status: "deleted", external_post_id: null, external_url: null, sns_removed_at: null });
  });

  it("アカウントがつながっていなければ（期限切れなど）確かめない", async () => {
    const { postId } = await publishedTarget();
    const readPost = vi.fn(async (): Promise<PostState> => "exists");
    expect((await syncXTargetsOfPost(admin, { ...deps(readPost), loadToken: async () => null }, postId))[0].result).toBe("skipped");
    expect(readPost).not.toHaveBeenCalled();
  });

  it("利用者は送信の状態や、確かめた日時を自分で書き換えられない。他人の投稿は読めない", async () => {
    const { targetId } = await publishedTarget();
    await alice.from("post_targets").update({ status: "deleted", sns_removed_at: new Date().toISOString() }).eq("id", targetId);
    expect((await targetRow(targetId)).status).toBe("published");
    expect((await bob.from("post_targets").select("id").eq("id", targetId)).data).toEqual([]);
  });
});
