// 画像の準備を 1 回の送信ジョブの中で待ち続けないこと（docs/architecture.md の 4.7「1 回のジョブの時間」）。
// 準備中の状態を記録して次の回に続きを確かめる、時間が足りなければ次の回に回す、を確かめる。
// SNS には偽のアダプターを使う。取り出しは必ず postId を指定し、ほかの予約に触れない
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { continueStaged, type StagedOps } from "@/lib/sns/adapters/staged";
import { SnsPublishError, type PrepareState, type PublishImage, type SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets, type PublisherDeps } from "@/lib/sns/publisher";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";

let alice: TestClient;
let aliceId: string;
let projectId: string;
let accountId: string;

const images: PublishImage[] = [{ url: "https://storage.example/1.jpg", altText: "", load: async () => new Uint8Array() }];

// startPublish はコンテナを作るだけ。continuePublish は readyAfter 回目に公開まで進む偽物
function stagedAdapter(readyAfter: number, overrides: Partial<SnsAdapter> = {}): SnsAdapter {
  let checks = 0;
  return {
    sns: "threads",
    publishText: vi.fn(async () => ({ externalPostId: "text", url: null })),
    deletePost: vi.fn(async () => {}),
    startPublish: vi.fn(async () => ({ kind: "single", id: `c-${randomUUID()}` }) as PrepareState),
    continuePublish: vi.fn(async (_account, state: PrepareState) => {
      checks += 1;
      return checks >= readyAfter ? { done: { externalPostId: `m-${String(state.id)}`, url: "https://www.threads.com/p/1" } } : { state };
    }),
    ...overrides,
  };
}

const deps = (adapter: SnsAdapter): PublisherDeps => ({ adapters: { threads: adapter }, key, loadImages: async () => images });

async function scheduledPost(body = "画像つき"): Promise<{ postId: string; targetId: string }> {
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

// 次の回のジョブを待たずに、続きを確かめる時刻を今にする
async function makeDueNow(id: string) {
  await admin.from("post_targets").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "準備中" }).select("id").single()).data!.id;
  accountId = await saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "threads", externalId: `threads-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date(FUTURE), scopes: [] },
    key,
  );
});

afterAll(async () => {
  await deleteUser(aliceId);
});

describe("画像の準備を待ち続けない", () => {
  it("すぐ準備できれば、その回で公開まで進む", async () => {
    const adapter = stagedAdapter(1);
    const { postId, targetId } = await scheduledPost();
    const [outcome] = await publishDueTargets(admin, deps(adapter), { postId });
    expect(outcome.result).toBe("published");
    expect(adapter.publishText).not.toHaveBeenCalled();
    expect(await target(targetId)).toMatchObject({ status: "published", sns_container: null, preparing_since: null });
  });

  it("準備中なら状態を記録して終わり、次の回に続きを確かめて公開する（試した回数は増やさない）", async () => {
    const adapter = stagedAdapter(3);
    const { postId, targetId } = await scheduledPost();

    const [first] = await publishDueTargets(admin, deps(adapter), { postId });
    expect(first.result).toBe("preparing");
    const t1 = await target(targetId);
    expect(t1.status).toBe("preparing");
    expect(t1.sns_container).toMatchObject({ kind: "single" });
    expect(t1.preparing_since).not.toBeNull();
    expect(t1.attempts).toBe(1);
    // 続きを確かめる時刻（15 秒後）が来るまでは取り出さない
    expect(await publishDueTargets(admin, deps(adapter), { postId })).toEqual([]);

    await makeDueNow(targetId);
    expect((await publishDueTargets(admin, deps(adapter), { postId }))[0].result).toBe("preparing");
    await makeDueNow(targetId);
    expect((await publishDueTargets(admin, deps(adapter), { postId }))[0].result).toBe("published");

    expect(adapter.startPublish).toHaveBeenCalledTimes(1);
    expect(await target(targetId)).toMatchObject({ status: "published", attempts: 1, sns_container: null });
  });

  it("準備に 15 分以上かかったら、最初からやり直す（コンテナを作り直す）", async () => {
    const adapter = stagedAdapter(100);
    const { postId, targetId } = await scheduledPost();
    await publishDueTargets(admin, deps(adapter), { postId });
    await admin
      .from("post_targets")
      .update({ preparing_since: new Date(Date.now() - 16 * 60_000).toISOString(), next_attempt_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", targetId);
    const [outcome] = await publishDueTargets(admin, deps(adapter), { postId });
    expect(outcome.result).toBe("retry");
    expect(await target(targetId)).toMatchObject({ status: "pending", sns_container: null, preparing_since: null });
  });

  it("SNS が断ったら失敗にし、準備の途中の記録を消す", async () => {
    const adapter = stagedAdapter(100, {
      continuePublish: vi.fn(async () => {
        throw new SnsPublishError("permanent", "Threads が投稿を受け付けませんでした");
      }),
    });
    const { postId, targetId } = await scheduledPost();
    const [outcome] = await publishDueTargets(admin, deps(adapter), { postId });
    expect(outcome.result).toBe("failed");
    expect(await target(targetId)).toMatchObject({ status: "failed", sns_container: null });
  });
});

describe("1 回のジョブの時間", () => {
  it("時間が足りなければ、取り出した配信先を元に戻して次の回に回す（試した回数も戻す）", async () => {
    const adapter = stagedAdapter(1);
    const { postId, targetId } = await scheduledPost();
    const [outcome] = await publishDueTargets(admin, deps(adapter), { postId, deadlineMs: -1 });
    expect(outcome.result).toBe("deferred");
    expect(adapter.startPublish).not.toHaveBeenCalled();
    expect(await target(targetId)).toMatchObject({ status: "pending", attempts: 0, locked_at: null });

    // 準備中のものを回したときは、準備中のまま戻す
    const slow = stagedAdapter(100);
    await publishDueTargets(admin, deps(slow), { postId });
    await makeDueNow(targetId);
    expect((await publishDueTargets(admin, deps(slow), { postId, deadlineMs: -1 }))[0].result).toBe("deferred");
    expect(await target(targetId)).toMatchObject({ status: "preparing", attempts: 1 });
  });
});

describe("段階で進める共通部分（staged.ts）", () => {
  const ops = (statuses: Record<string, string[]>): StagedOps & { created: string[][] } => {
    const created: string[][] = [];
    return {
      created,
      label: "Threads",
      status: async (id) => ({ status: (statuses[id]?.shift() ?? "FINISHED") as "FINISHED" }),
      createCarousel: async (children) => {
        created.push(children);
        return "parent";
      },
      publish: async (id) => `m-${id}`,
      permalink: async () => null,
      toError: (e) => (e instanceof SnsPublishError ? e : new SnsPublishError("unknown", "x")),
    };
  };

  it("カルーセルは、子がすべて準備できてから親を作り、親の準備ができたら公開する", async () => {
    const o = ops({ a: ["IN_PROGRESS", "FINISHED"], b: ["FINISHED", "FINISHED"], parent: ["IN_PROGRESS", "FINISHED"] });
    const start = { kind: "carousel", children: ["a", "b"], text: "本文" };
    const s1 = await continueStaged(o, start);
    expect(s1).toEqual({ state: start });
    const s2 = await continueStaged(o, start);
    expect(s2).toEqual({ state: { ...start, parent: "parent" } });
    expect(o.created).toEqual([["a", "b"]]);
    const s3 = await continueStaged(o, (s2 as { state: PrepareState }).state);
    expect(s3).toEqual({ state: { ...start, parent: "parent" } });
    expect(await continueStaged(o, { ...start, parent: "parent" })).toEqual({ done: { externalPostId: "m-parent", url: null } });
  });

  it("ERROR・EXPIRED は受け付けられなかったとして止める。読めない状態も止める", async () => {
    await expect(continueStaged(ops({ x: ["ERROR"] }), { kind: "single", id: "x" })).rejects.toMatchObject({ kind: "permanent" });
    await expect(continueStaged(ops({}), { kind: "nope" })).rejects.toMatchObject({ kind: "permanent" });
  });
});
