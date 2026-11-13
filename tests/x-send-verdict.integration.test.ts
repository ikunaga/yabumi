// X の月の上限を送る前に出す（PMO の通しテスト。fix/walkthrough-2）: xSendVerdict が送信ジョブと同じ額で判定する・予約が来月に回れば上限が戻る（日本時間）・
// 「X は手で投稿する」を選んだ X の配信先は、上限が空いても送信ジョブが送らない（手で出したものと二重にならない）。
// X は偽のアダプターで、本物は呼ばない。取り出しは必ず postId を指定し、全体の額はこの利用者の分だけで数える（budgetScopeOwner・scopeOwner）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets, type PublisherDeps } from "@/lib/sns/publisher";
import { markXByHand, xByHandTooLateMessage } from "@/lib/posts/x-by-hand";
import { X_BY_HAND_MESSAGE } from "@/lib/sns/x/send-rules";
import { xSendVerdict } from "@/lib/sns/x/send-verdict";
import { xPostCostUsd } from "@/lib/sns/x/pricing";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));
let current: TestClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
const { listDueManualPosts, listPostsNeedingAttention } = await import("@/lib/posts/queries");
const { loadCalendarStats } = await import("@/lib/calendar/stats");

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let aliceId: string;
let projectId: string;
let xAccountId: string;
let threadsAccountId: string;

const spend = async (usd: number) =>
  admin.from("sns_api_usage").insert({ owner_id: aliceId, sns: "x", operation: "post", cost_usd: usd });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "ねむり日和" }).select("id").single()).data!.id;
  const account = (sns: "x" | "threads") =>
    saveConnectedAccount(admin, { ownerId: aliceId, sns, externalId: `${sns}-${randomUUID()}`, displayName: "", handle: "nemuri", accessToken: "tok", refreshToken: "r", expiresAt: new Date("2099-01-01"), scopes: sns === "x" ? ["media.write"] : [] }, key);
  current = alice;
  xAccountId = await account("x");
  threadsAccountId = await account("threads");
});
beforeEach(async () => {
  await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
});
afterAll(async () => {
  await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
});

describe("xSendVerdict（送信ジョブと同じ額・同じ比べ方）", () => {
  it("今月の自分の額 ＋ この投稿 が 1 人の上限を超えると user。URL のない短い投稿なら送れる", async () => {
    await spend(0.9);
    const url = await xSendVerdict(admin, aliceId, { text: "新しい版 https://example.com", altCount: 0, scopeOwner: aliceId });
    expect(url).toMatchObject({ over: "user", costUsd: xPostCostUsd("https://example.com"), userBudgetUsd: 1 });
    expect((await xSendVerdict(admin, aliceId, { text: "新しい版", altCount: 0, scopeOwner: aliceId })).over).toBeNull();
  });

  it("予約が来月（日本時間）に回るなら、今月の額は数えない。同じ月の予約は数える", async () => {
    await spend(1);
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 3600_000);
    // 来月 1 日 0:00（日本時間）と、今月の残り（いまの 1 分後）
    const nextMonth = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 1) - 9 * 3600_000);
    const later = await xSendVerdict(admin, aliceId, { text: "a", altCount: 0, at: nextMonth, now, scopeOwner: aliceId });
    expect(later.over).toBeNull();
    const sameMonth = await xSendVerdict(admin, aliceId, { text: "a", altCount: 0, at: new Date(nextMonth.getTime() - 60_000), now, scopeOwner: aliceId });
    expect(sameMonth.over).toBe("user");
  });
});

describe("「X は手で投稿する」を選んだ X の配信先", () => {
  it("送らない印になり、上限が空いても送信ジョブは X を送らない。ほかの SNS は送る", async () => {
    await spend(1);
    const { data: postId, error } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: projectId,
      p_body: "本文",
      p_planned_at: new Date(Date.now() - 60_000).toISOString(),
      p_status: "draft",
      p_targets: [
        { sns: "x", social_account_id: xAccountId },
        { sns: "threads", social_account_id: threadsAccountId },
      ],
    });
    expect(error).toBeNull();
    await markXByHand(admin, postId!, aliceId);
    await alice.from("posts").update({ status: "scheduled" }).eq("id", postId!);
    const x = (await admin.from("post_targets").select("status, error_message").eq("post_id", postId!).eq("sns", "x").single()).data!;
    expect(x).toEqual({ status: "failed", error_message: X_BY_HAND_MESSAGE });

    // 月が替わった・額の見込みが変わったのと同じ（上限が空く）
    await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
    const fake = (sns: "x" | "threads"): SnsAdapter => ({ sns, publishText: vi.fn(async () => ({ externalPostId: `m-${randomUUID()}`, url: `https://example.com/${sns}` })), deletePost: vi.fn(async () => {}) });
    const xAdapter = { ...fake("x"), publishCost: (text: string) => ({ operation: "post" as const, costUsd: xPostCostUsd(text) }) };
    const threadsAdapter = fake("threads");
    const deps: PublisherDeps = { adapters: { x: xAdapter, threads: threadsAdapter }, key, budgetsUsd: { x: 3 }, userBudgetsUsd: { x: 1 }, budgetScopeOwner: aliceId };
    await publishDueTargets(admin, deps, { postId: postId! });
    expect(xAdapter.publishText).not.toHaveBeenCalled();
    expect(threadsAdapter.publishText).toHaveBeenCalled();

    // 保存し直しても（送り直しは X を除く）、X は送らない印のまま
    expect((await alice.rpc("requeue_failed_targets", { p_post_id: postId!, p_sns: ["threads"] })).error).toBeNull();
    await publishDueTargets(admin, deps, { postId: postId! });
    expect(xAdapter.publishText).not.toHaveBeenCalled();
    expect((await admin.from("post_targets").select("status").eq("post_id", postId!).eq("sns", "x").single()).data!.status).toBe("failed");
  });

  it("送った X の配信先は変えない", async () => {
    const { data: postId } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: projectId,
      p_body: "本文",
      p_planned_at: "2099-01-01T00:00:00Z",
      p_status: "draft",
      p_targets: [{ sns: "x", social_account_id: xAccountId }],
    });
    await admin.from("post_targets").update({ status: "published", external_post_id: "1", published_at: new Date().toISOString() }).eq("post_id", postId!);
    await markXByHand(admin, postId!, aliceId);
    expect((await admin.from("post_targets").select("status").eq("post_id", postId!).single()).data!.status).toBe("published");
  });

  it("概要の「送れなかった投稿」とカレンダーの失敗の数に、手で投稿の X だけの投稿は入らない。ほかの失敗は入る", async () => {
    const save = async () =>
      (await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: projectId, p_body: "数える", p_planned_at: "2099-01-15T00:00:00Z", p_status: "scheduled", p_targets: [{ sns: "x", social_account_id: xAccountId }, { sns: "threads", social_account_id: threadsAccountId }] })).data!;
    const hand = await save();
    await markXByHand(admin, hand, aliceId);
    const broken = await save();
    await admin.from("post_targets").update({ status: "failed", error_message: "Threads に送れませんでした" }).eq("post_id", broken).eq("sns", "threads");
    const ids = (await listPostsNeedingAttention(projectId, 50)).map((p) => p.id);
    expect(ids).toContain(broken);
    expect(ids).not.toContain(hand);
    expect((await loadCalendarStats(projectId, "2099-01", alice)).failed).toBe(1);
  });

  it("送る時刻が来たら、手で投稿の X は概要の「手で投稿する番」に出る（忘れないように）。まだ先の予約は出ない", async () => {
    const save = async (at: string) =>
      (await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: projectId, p_body: "手で出す", p_planned_at: at, p_status: "draft", p_targets: [{ sns: "x", social_account_id: xAccountId }] })).data!;
    const past = await save(new Date(Date.now() - 3600_000).toISOString());
    const future = await save("2099-02-01T00:00:00Z");
    for (const id of [past, future]) {
      await markXByHand(admin, id, aliceId);
      await alice.from("posts").update({ status: "scheduled" }).eq("id", id);
    }
    const ids = (await listDueManualPosts(projectId)).map((p) => p.id);
    expect(ids).toContain(past);
    expect(ids).not.toContain(future);
  });

  it("App-L2: 送信ジョブが先に X を取り出していたら印を付けず、いまの状態を返す（手でも出して二重にならないよう、保存で知らせる）", async () => {
    const { data: postId } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: projectId,
      p_body: "二重にしない",
      p_planned_at: "2099-03-01T00:00:00Z",
      p_status: "draft",
      p_targets: [{ sns: "x", social_account_id: xAccountId }],
    });
    // 予約を読んだあと、印を付ける前に、送信ジョブが X を取り出した
    await admin.from("post_targets").update({ status: "publishing", locked_at: new Date().toISOString() }).eq("post_id", postId!).eq("sns", "x");
    expect(await markXByHand(admin, postId!, aliceId)).toEqual({ ok: false, status: "publishing" });
    expect((await admin.from("post_targets").select("status, error_message").eq("post_id", postId!).single()).data).toEqual({ status: "publishing", error_message: null });
    expect(xByHandTooLateMessage("publishing")).toContain("手では出さないでください");
    // まだ送信待ちなら印を付ける
    await admin.from("post_targets").update({ status: "pending", locked_at: null }).eq("post_id", postId!);
    expect(await markXByHand(admin, postId!, aliceId)).toEqual({ ok: true });
  });
});

