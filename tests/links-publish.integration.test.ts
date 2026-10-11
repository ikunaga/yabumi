// 送る直前の短縮リンクへの置き換え（docs/architecture.md の 4.22、決定 D20）。送信ジョブの作り変え（準備中の続き）と合わせて確かめる。
// SNS には偽のアダプターを使う。取り出しは必ず postId を指定し、ほかの予約に触れない
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { preparePostLinks, postLinkPreview } from "@/lib/links/store";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { PrepareState, PublishImage, SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets } from "@/lib/sns/publisher";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";
const STORE = "https://apps.apple.com/jp/app/id123456789";

let alice: TestClient;
let aliceId: string;
let projectId: string;
let accountId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "置き換え" }).select("id").single()).data!.id;
  accountId = await saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "threads", externalId: `threads-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date(FUTURE), scopes: [] },
    key,
  );
});

afterAll(async () => {
  await deleteUser(aliceId);
});

async function scheduledPost(body: string, shortLinks: boolean) {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: body,
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: [{ sns: "threads", social_account_id: accountId }],
  });
  if (error) throw error;
  await preparePostLinks(admin, { ownerId: aliceId, projectId, postId: postId!, enabled: shortLinks });
  const { data } = await admin.from("post_targets").select("id").eq("post_id", postId!).single();
  return { postId: postId!, targetId: data!.id };
}

describe("送る直前の置き換え", () => {
  it("文章だけの投稿: 作成画面に出した短縮リンクのとおりに送る", async () => {
    const { postId } = await scheduledPost(`見てね ${STORE}`, true);
    const short = (await postLinkPreview(alice, postId)).threads![0].url;
    const adapter: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: "m1", url: null })), deletePost: vi.fn() };
    const [o] = await publishDueTargets(admin, { adapters: { threads: adapter }, key, loadImages: async () => [] }, { postId });
    expect(o.result).toBe("published");
    expect(vi.mocked(adapter.publishText).mock.calls[0][1]).toBe(`見てね ${short}`);
  });

  it("チェックを外して保存した投稿は、元の URL のまま送る", async () => {
    const { postId } = await scheduledPost(`見てね ${STORE}`, false);
    const adapter: SnsAdapter = { sns: "threads", publishText: vi.fn(async () => ({ externalPostId: "m2", url: null })), deletePost: vi.fn() };
    await publishDueTargets(admin, { adapters: { threads: adapter }, key, loadImages: async () => [] }, { postId });
    expect(vi.mocked(adapter.publishText).mock.calls[0][1]).toBe(`見てね ${STORE}`);
  });

  it("画像つきで準備中になっても、置き換えた本文でコンテナを作り、続きでは作り直さない", async () => {
    const { postId, targetId } = await scheduledPost(`画像と ${STORE}`, true);
    const short = (await postLinkPreview(alice, postId)).threads![0].url;
    let checks = 0;
    const adapter: SnsAdapter = {
      sns: "threads",
      publishText: vi.fn(),
      deletePost: vi.fn(),
      startPublish: vi.fn(async () => ({ kind: "single", id: "c1" }) as PrepareState),
      continuePublish: vi.fn(async (_a, state: PrepareState) => (++checks >= 2 ? { done: { externalPostId: "m3", url: null } } : { state })),
    };
    const images: PublishImage[] = [{ url: "https://storage.example/1.jpg", altText: "", load: async () => new Uint8Array() }];
    const deps = { adapters: { threads: adapter }, key, loadImages: async () => images };
    const [first] = await publishDueTargets(admin, deps, { postId });
    expect(first.result).toBe("preparing");
    expect(vi.mocked(adapter.startPublish!).mock.calls[0][1]).toBe(`画像と ${short}`);
    await admin.from("post_targets").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("id", targetId);
    const [second] = await publishDueTargets(admin, deps, { postId });
    expect(second.result).toBe("published");
    expect(adapter.startPublish).toHaveBeenCalledTimes(1);
  });
});
