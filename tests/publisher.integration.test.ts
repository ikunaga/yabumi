// 送信ジョブ（取り出し・二重送信の防止・やり直し・取り消し・トークンの延長）と、送信まわりの権限。
// SNS には偽のアダプターを使い、本物の Threads には送らない。
// 他のデータ（オーナーの本物の予約など）に触れないよう、取り出しは必ず postId を指定する。
// 投稿の日時は未来にして、定期実行のジョブ（pg_cron）にも拾われないようにする。
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { SnsPublishError, type SnsAdapter } from "@/lib/sns/adapters/types";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { deletePublishedTarget, publishDueTargets, refreshDueTokens, type PublisherDeps } from "@/lib/sns/publisher";
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

function fakeAdapter(overrides: Partial<SnsAdapter> = {}): SnsAdapter {
  return {
    sns: "threads",
    publishText: vi.fn(async () => ({ externalPostId: `m-${randomUUID()}`, url: "https://www.threads.com/@alice/post/x" })),
    deletePost: vi.fn(async () => {}),
    ...overrides,
  };
}

const depsWith = (adapter: SnsAdapter): PublisherDeps => ({ adapters: { threads: adapter }, key });

async function scheduledPost(body = "こんにちは"): Promise<{ postId: string; targetId: string }> {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: body,
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: [{ sns: "threads", social_account_id: accountId }],
  });
  if (error) throw error;
  const { data } = await admin.from("post_targets").select("id").eq("post_id", postId!).single();
  return { postId: postId!, targetId: data!.id };
}

async function target(id: string) {
  const { data } = await admin.from("post_targets").select("*").eq("id", id).single();
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
      sns: "threads",
      externalId: `threads-${randomUUID()}`,
      displayName: "Alice",
      handle: "alice",
      accessToken: "token-1",
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      scopes: ["threads_basic"],
    },
    key,
  );
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("送信ジョブ", () => {
  it("取り出して送り、投稿 ID と URL を記録する", async () => {
    const { postId, targetId } = await scheduledPost("本文です");
    const adapter = fakeAdapter();
    const outcomes = await publishDueTargets(admin, depsWith(adapter), { postId });
    expect(outcomes.map((o) => o.result)).toEqual(["published"]);
    expect(adapter.publishText).toHaveBeenCalledWith({ externalId: expect.any(String), accessToken: "token-1" }, "本文です");
    const t = await target(targetId);
    expect(t.status).toBe("published");
    expect(t.external_post_id).toMatch(/^m-/);
    expect(t.external_url).toBe("https://www.threads.com/@alice/post/x");
    expect(t.published_at).not.toBeNull();
    expect(t.attempts).toBe(1);
  });

  it("SNS 用に変えた文面があればそれを送る", async () => {
    const { postId, targetId } = await scheduledPost("共通");
    await alice.from("post_targets").update({ body_override: "Threads 用" }).eq("id", targetId);
    const adapter = fakeAdapter();
    await publishDueTargets(admin, depsWith(adapter), { postId });
    expect(adapter.publishText).toHaveBeenCalledWith(expect.anything(), "Threads 用");
  });

  it("ジョブが同時に動いても 1 回しか送らない", async () => {
    const { postId } = await scheduledPost();
    const adapter = fakeAdapter();
    const results = await Promise.all([1, 2, 3].map(() => publishDueTargets(admin, depsWith(adapter), { postId })));
    expect(results.flat()).toHaveLength(1);
    expect(adapter.publishText).toHaveBeenCalledTimes(1);
  });

  it("送信済みのものは二度と取り出さない", async () => {
    const { postId } = await scheduledPost();
    const adapter = fakeAdapter();
    await publishDueTargets(admin, depsWith(adapter), { postId });
    expect(await publishDueTargets(admin, depsWith(adapter), { postId })).toEqual([]);
    expect(adapter.publishText).toHaveBeenCalledTimes(1);
  });

  it("下書きは送らない", async () => {
    const { postId } = await scheduledPost();
    await alice.from("posts").update({ status: "draft" }).eq("id", postId);
    expect(await publishDueTargets(admin, depsWith(fakeAdapter()), { postId })).toEqual([]);
  });

  it("一時的な失敗は間をあけてやり直し、3 回目で失敗にする", async () => {
    const { postId, targetId } = await scheduledPost();
    const adapter = fakeAdapter({
      publishText: vi.fn(async () => {
        throw new SnsPublishError("retryable", "回数制限");
      }),
    });
    const r1 = await publishDueTargets(admin, depsWith(adapter), { postId });
    expect(r1[0].result).toBe("retry");
    let t = await target(targetId);
    expect(t.status).toBe("pending");
    expect(t.attempts).toBe(1);
    expect(t.error_message).toBe("回数制限");
    expect(new Date(t.next_attempt_at!).getTime()).toBeGreaterThan(Date.now());

    await publishDueTargets(admin, depsWith(adapter), { postId });
    const r3 = await publishDueTargets(admin, depsWith(adapter), { postId });
    expect(r3[0].result).toBe("failed");
    t = await target(targetId);
    expect(t.status).toBe("failed");
    expect(t.attempts).toBe(3);
  });

  it("送れたかわからない失敗はやり直さない", async () => {
    const { postId, targetId } = await scheduledPost();
    const adapter = fakeAdapter({
      publishText: vi.fn(async () => {
        throw new SnsPublishError("unknown", "途中で切れた");
      }),
    });
    expect((await publishDueTargets(admin, depsWith(adapter), { postId }))[0].result).toBe("failed");
    expect((await target(targetId)).status).toBe("failed");
  });

  it("送信中のまま止まったものは、送り直さずに失敗にする", async () => {
    const { postId, targetId } = await scheduledPost();
    // 送信中にしたまま 11 分たった状態を作る
    await admin
      .from("post_targets")
      .update({ status: "publishing", locked_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() })
      .eq("id", targetId);
    const adapter = fakeAdapter();
    await publishDueTargets(admin, depsWith(adapter), { postId });
    expect(adapter.publishText).not.toHaveBeenCalled();
    const t = await target(targetId);
    expect(t.status).toBe("failed");
    expect(t.error_message).toContain("止まりました");
  });

  it("失敗したものは本人が送り直せる状態に戻せる。他人は戻せない", async () => {
    const { postId, targetId } = await scheduledPost();
    await admin.from("post_targets").update({ status: "failed", attempts: 3, error_message: "x" }).eq("id", targetId);

    const { error: bobError } = await bob.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: ["threads"] });
    expect(bobError).not.toBeNull();
    expect((await target(targetId)).status).toBe("failed");

    const { data: count, error } = await alice.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: ["threads"] });
    expect(error).toBeNull();
    expect(count).toBe(1);
    const t = await target(targetId);
    expect(t).toMatchObject({ status: "pending", attempts: 0, error_message: null });
  });

  it("トークンが無効なら失敗にして、アカウントを期限切れにする", async () => {
    const { postId, targetId } = await scheduledPost();
    const adapter = fakeAdapter({
      publishText: vi.fn(async () => {
        throw new SnsPublishError("auth", "つなぎ直してください");
      }),
    });
    await publishDueTargets(admin, depsWith(adapter), { postId });
    expect((await target(targetId)).status).toBe("failed");
    const { data } = await admin.from("social_accounts").select("status").eq("id", accountId).single();
    expect(data!.status).toBe("expired");

    // 期限切れのアカウントへは送らない
    const next = await scheduledPost();
    const adapter2 = fakeAdapter();
    const r = await publishDueTargets(admin, depsWith(adapter2), { postId: next.postId });
    expect(r[0].result).toBe("failed");
    expect(adapter2.publishText).not.toHaveBeenCalled();
    await admin.from("social_accounts").update({ status: "active" }).eq("id", accountId);
  });
});

describe("SNS 上での取り消し", () => {
  it("送信済みのものを取り消し、状態を deleted にする", async () => {
    const { postId, targetId } = await scheduledPost();
    const adapter = fakeAdapter();
    await publishDueTargets(admin, depsWith(adapter), { postId });
    const sent = await target(targetId);
    await deletePublishedTarget(admin, targetId, depsWith(adapter));
    expect(adapter.deletePost).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "token-1" }), sent.external_post_id);
    expect((await target(targetId)).status).toBe("deleted");
  });

  it("送信していないものは取り消せない", async () => {
    const { targetId } = await scheduledPost();
    await expect(deletePublishedTarget(admin, targetId, depsWith(fakeAdapter()))).rejects.toBeInstanceOf(SnsPublishError);
  });
});

describe("送信まわりの権限", () => {
  it("利用者は送信の状態を書き換えられない（送信済みの偽装を防ぐ）", async () => {
    const { targetId } = await scheduledPost();
    const { error } = await alice.from("post_targets").update({ status: "published", external_post_id: "fake" }).eq("id", targetId);
    expect(error).not.toBeNull();
    expect((await target(targetId)).status).toBe("pending");
  });

  it("利用者は送信の状態を付けて配信先を作れない", async () => {
    const { postId } = await scheduledPost();
    const { error } = await alice.from("post_targets").insert({ post_id: postId, sns: "x", status: "published" });
    expect(error).not.toBeNull();
  });

  it("利用者は送信の結果を読める。他人は読めない", async () => {
    const { targetId } = await scheduledPost();
    expect((await alice.from("post_targets").select("status, external_url").eq("id", targetId)).data).toHaveLength(1);
    expect((await bob.from("post_targets").select("status").eq("id", targetId)).data).toEqual([]);
  });

  it("利用者は取り出しの関数を呼べない", async () => {
    const { error } = await alice.rpc("claim_due_targets", { p_limit: 10, p_post_id: null as unknown as string });
    expect(error).not.toBeNull();
  });

  it("利用者はジョブの呼び出し関数を呼べない", async () => {
    const { error } = await alice.rpc("invoke_job" as never, { p_path: "/api/jobs/publish" } as never);
    expect(error).not.toBeNull();
  });
});

describe("トークンの延長", () => {
  it("期限まで 30 日を切り、発行から 24 時間たったトークンを延長する", async () => {
    const now = new Date();
    await admin
      .from("social_account_tokens")
      .update({ expires_at: new Date(now.getTime() + 10 * 86400_000).toISOString() })
      .eq("social_account_id", accountId);
    // updated_at はトリガーで今になるので、24 時間前に戻す（トリガーを通さない insert で入れ直す）
    const { data: row } = await admin.from("social_account_tokens").select("*").eq("social_account_id", accountId).single();
    await admin.from("social_account_tokens").delete().eq("social_account_id", accountId);
    await admin.from("social_account_tokens").insert({ ...row!, updated_at: new Date(now.getTime() - 2 * 86400_000).toISOString() });

    const newExpiry = new Date(now.getTime() + 60 * 86400_000);
    const adapter = fakeAdapter({
      refreshToken: vi.fn(async () => ({ accessToken: "token-2", expiresAt: newExpiry })),
      shouldRefresh: (expiresAt: Date, at: Date) => expiresAt.getTime() - at.getTime() < 30 * 86400_000,
    });
    const outcomes = await refreshDueTokens(admin, { ...depsWith(adapter), now: () => now });
    expect(outcomes.find((o) => o.socialAccountId === accountId)?.result).toBe("refreshed");

    const { data } = await admin.from("social_account_tokens").select("*").eq("social_account_id", accountId).single();
    expect(decryptToken(data!.access_token_encrypted, accountId, key)).toBe("token-2");
    expect(new Date(data!.expires_at!).getTime()).toBe(newExpiry.getTime());
  });
});
