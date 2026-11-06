// X の人気の投稿から（B 案。4.52）: ネタの材料 x_post の会話、引用の X の下書き（quote_post_id）の保存・権限・送信ジョブ・「投稿した」の記録。
// AI と X は偽物で、本物は呼ばない。取り出しは必ず postId を指定し、日時は未来にして pg_cron に拾われないようにする
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adoptPostIdea, generatePostIdeas, refinePostIdeas, type CallIdeas, type IdeasContent } from "@/lib/ai/post-ideas";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets } from "@/lib/sns/publisher";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
const FUTURE = "2099-01-01T00:00:00Z";
const QUOTE_ID = "1850000000000000001";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let xAccountId: string;

const usage = { inputTokens: 8000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 2000 };
const ideasOutput = {
  ideas: [{ pillar: "季節のおすすめ", title: "朝の焼き上がり", angle: "書き出しの問いかけを借りた", commits: [], notes: [], drafts: [{ sns: "x", text: "朝 7 時、店の前がいちばんいい匂いになります。" }, { sns: "threads", text: "Threads の文" }] }],
  questions: [],
};
const caller = (): CallIdeas => vi.fn(async () => ({ output: ideasOutput, stopReason: "end_turn", model: "claude-opus-5-5", usage }));
const noCommits = vi.fn(async () => ({ commits: [], truncated: false }));

async function savePost(targets: object[], status = "draft", plannedAt: string | null = null, postId: string | null = null) {
  return alice.rpc("save_post", {
    p_post_id: postId as unknown as string,
    p_project_id: projectId,
    p_body: "本文",
    p_planned_at: plannedAt as unknown as string,
    p_status: status,
    p_targets: targets as never,
  });
}
const xTarget = async (postId: string) =>
  (await admin.from("post_targets").select("id, sns, status, quote_post_id, external_url").eq("post_id", postId).eq("sns", "x").single()).data!;

scopeAiBudget();
beforeEach(async () => {
  if (aliceId) await admin.from("ai_usage").delete().eq("owner_id", aliceId);
});

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "パン屋こむぎ", description: "天然酵母のパン屋です" }).select("id").single()).data!.id;
  xAccountId = await saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "x", externalId: `x-${randomUUID()}`, displayName: "", handle: "komugi", accessToken: "tok", refreshToken: "refresh-1", expiresAt: new Date("2099-01-01"), scopes: [] },
    key,
  );
});

afterAll(async () => {
  for (const id of [aliceId, bobId]) {
    await admin.from("ai_usage").delete().eq("owner_id", id);
    await admin.from("sns_api_usage").delete().eq("owner_id", id);
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("引用の X の配信先（quote_post_id）", () => {
  it("save_post で引用する投稿の id を保存できる。前の呼び方（キーなし）でも保存でき、null になる", async () => {
    const { data: postId, error } = await savePost([{ sns: "x", social_account_id: xAccountId, quote_post_id: QUOTE_ID }]);
    expect(error).toBeNull();
    expect(await xTarget(postId!)).toMatchObject({ status: "pending", quote_post_id: QUOTE_ID });

    const { data: old, error: oldError } = await savePost([{ sns: "x", social_account_id: xAccountId, body_override: null }]);
    expect(oldError).toBeNull();
    expect(await xTarget(old!)).toMatchObject({ status: "pending", quote_post_id: null });
  });

  it("引用を外して保存し直すと、null になる", async () => {
    const { data: postId } = await savePost([{ sns: "x", quote_post_id: QUOTE_ID }]);
    expect((await savePost([{ sns: "x", quote_post_id: null }], "draft", null, postId!)).error).toBeNull();
    expect((await xTarget(postId!)).quote_post_id).toBeNull();
  });

  it("形は DB でも縛る: X の配信先だけ・数字だけ・19 桁まで", async () => {
    expect((await savePost([{ sns: "threads", quote_post_id: QUOTE_ID }])).error).not.toBeNull();
    expect((await savePost([{ sns: "x", quote_post_id: "12a" }])).error).not.toBeNull();
    expect((await savePost([{ sns: "x", quote_post_id: "0123" }])).error).not.toBeNull();
    expect((await savePost([{ sns: "x", quote_post_id: "1".repeat(20) }])).error).not.toBeNull();
  });

  it("本人は列を直接書ける（title・body_override と同じ）。他人の配信先は書けない。状態の列は書けない", async () => {
    const { data: postId } = await savePost([{ sns: "x" }]);
    const t = await xTarget(postId!);
    expect((await alice.from("post_targets").update({ quote_post_id: QUOTE_ID }).eq("id", t.id)).error).toBeNull();
    expect((await xTarget(postId!)).quote_post_id).toBe(QUOTE_ID);
    const { data: bobRows } = await bob.from("post_targets").update({ quote_post_id: "999" }).eq("id", t.id).select("id");
    expect(bobRows).toEqual([]);
    expect((await xTarget(postId!)).quote_post_id).toBe(QUOTE_ID);
    expect((await alice.from("post_targets").update({ status: "published" }).eq("id", t.id)).error).not.toBeNull();
  });

  it("送信ジョブは引用の配信先を拾わない（予約にしてあっても X には送らない）", async () => {
    const { data: postId } = await savePost([{ sns: "x", social_account_id: xAccountId, quote_post_id: QUOTE_ID }], "scheduled", FUTURE);
    const adapter: SnsAdapter = { sns: "x", publishText: vi.fn(async () => ({ externalPostId: "1", url: null })), deletePost: vi.fn() };
    const outcomes = await publishDueTargets(admin, { adapters: { x: adapter }, key }, { postId: postId! });
    expect(outcomes).toEqual([]);
    expect(adapter.publishText).not.toHaveBeenCalled();
    expect((await xTarget(postId!)).status).toBe("pending");
  });

  it("引用の X は「投稿した」で記録でき、記録したら引用した投稿の id を持たない。引用でない pending の X は記録できない", async () => {
    const { data: postId } = await savePost([{ sns: "x", quote_post_id: QUOTE_ID }]);
    const t = await xTarget(postId!);
    // 他人は記録できない
    expect((await bob.rpc("mark_manual_target_posted", { p_target_id: t.id, p_url: "" })).error).not.toBeNull();
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: t.id, p_url: "https://x.com/komugi/status/1860000000000000002" })).error).toBeNull();
    expect(await xTarget(postId!)).toMatchObject({ status: "published", quote_post_id: null, external_url: "https://x.com/komugi/status/1860000000000000002" });
    // 二度は記録しない
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: t.id, p_url: "" })).error).not.toBeNull();

    const { data: plain } = await savePost([{ sns: "x", social_account_id: xAccountId }]);
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: (await xTarget(plain!)).id, p_url: "" })).error).not.toBeNull();
  });
});

describe("ネタの材料 x_post と、引用の下書き", () => {
  let threadId: string;

  it("貼った URL と文でネタを出し、会話に材料を残す（URL は x.com の形にそろえる）", async () => {
    const callIdeas = caller();
    const r = await generatePostIdeas(alice, admin, { callIdeas, readCommits: noCommits }, {
      userId: aliceId,
      projectId,
      sns: ["x", "threads"],
      input: { source: "x_post", url: "https://twitter.com/someone/status/1850000000000000001?s=20", text: "朝いちばんの匂いの話", interest: "" },
    });
    expect(r.ok).toBe(true);
    threadId = (r as { threadId: string }).threadId;
    const sent = JSON.stringify(vi.mocked(callIdeas).mock.calls[0][0].messages);
    expect(sent).toContain('<reference_post url=\\"https://x.com/someone/status/1850000000000000001\\">');
    const { data: rows } = await alice.from("ai_messages").select("role, content").eq("thread_id", threadId).order("created_at");
    expect(rows![0].content).toMatchObject({ source: "x_post", xPost: { url: "https://x.com/someone/status/1850000000000000001", id: QUOTE_ID, text: "朝いちばんの匂いの話", interest: "" } });
  });

  it("URL の形が違う・文も答えもないときは、AI を呼ばずに断る", async () => {
    const callIdeas = caller();
    const bad = await generatePostIdeas(alice, admin, { callIdeas, readCommits: noCommits }, { userId: aliceId, projectId, sns: ["x"], input: { source: "x_post", url: "https://example.com/a/status/1", text: "a", interest: "" } });
    expect(bad).toMatchObject({ ok: false });
    const empty = await generatePostIdeas(alice, admin, { callIdeas, readCommits: noCommits }, { userId: aliceId, projectId, sns: ["x"], input: { source: "x_post", url: "https://x.com/a/status/1", text: "", interest: "" } });
    expect(empty).toMatchObject({ ok: false });
    expect(callIdeas).not.toHaveBeenCalled();
  });

  it("出し直しにも貼った投稿を渡す", async () => {
    const callIdeas = caller();
    const r = await refinePostIdeas(alice, admin, { callIdeas }, { userId: aliceId, projectId, threadId, answers: [{ question: "q", answer: "a" }] });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(vi.mocked(callIdeas).mock.calls[0][0].messages)).toContain("朝いちばんの匂いの話");
  });

  it("「引用して X に投稿をつくる」は、X だけ・引用する投稿の id つきの下書きを作る。2 回押しても同じ下書き。ふつうの下書きとは別", async () => {
    const { data: msgs } = await alice.from("ai_messages").select("id, role, content").eq("thread_id", threadId).order("created_at").order("id");
    const latest = [...msgs!].reverse().find((m) => m.role === "assistant")!;
    const q1 = await adoptPostIdea(alice, admin, { userId: aliceId, projectId, messageId: latest.id, index: 0, accounts: { x: xAccountId }, quote: true });
    expect(q1.ok).toBe(true);
    const postId = (q1 as { postId: string }).postId;
    const { data: post } = await alice.from("posts").select("body, status, post_targets(sns, quote_post_id, body_override, social_account_id)").eq("id", postId).single();
    expect(post).toMatchObject({ body: "朝 7 時、店の前がいちばんいい匂いになります。", status: "draft", post_targets: [{ sns: "x", quote_post_id: QUOTE_ID, body_override: null, social_account_id: xAccountId }] });

    const q2 = await adoptPostIdea(alice, admin, { userId: aliceId, projectId, messageId: latest.id, index: 0, accounts: { x: xAccountId }, quote: true });
    expect(q2).toMatchObject({ ok: true, postId });
    const plain = await adoptPostIdea(alice, admin, { userId: aliceId, projectId, messageId: latest.id, index: 0, accounts: { x: xAccountId } });
    expect(plain.ok && plain.postId).not.toBe(postId);
    const { data: after } = await alice.from("ai_messages").select("content").eq("id", latest.id).single();
    expect(Object.keys((after!.content as unknown as IdeasContent).adopted).sort()).toEqual(["0", "q0"]);
  });

  it("材料が X の投稿でない会話からは、引用の下書きを作らない。他人の会話からも作らない", async () => {
    const r = await generatePostIdeas(alice, admin, { callIdeas: caller(), readCommits: noCommits }, { userId: aliceId, projectId, sns: ["x"], input: { source: "other", topic: "お休みのお知らせ" } });
    const { data: msgs } = await alice.from("ai_messages").select("id, role").eq("thread_id", (r as { threadId: string }).threadId);
    const id = msgs!.find((m) => m.role === "assistant")!.id;
    expect(await adoptPostIdea(alice, admin, { userId: aliceId, projectId, messageId: id, index: 0, accounts: {}, quote: true })).toMatchObject({ ok: false });

    const { data: mine } = await alice.from("ai_messages").select("id, role").eq("thread_id", threadId);
    const other = mine!.find((m) => m.role === "assistant")!.id;
    expect(await adoptPostIdea(bob, admin, { userId: bobId, projectId, messageId: other, index: 0, accounts: {}, quote: true })).toMatchObject({ ok: false });
  });
});
