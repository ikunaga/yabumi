// 最近のコミットから投稿のネタを出す流れと、ネタの会話の RLS。GitHub と AI はモックし、本物は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiLimits } from "@/lib/ai/limits";
import { adoptPostIdea, generatePostIdeas, KEEP_IDEA_THREADS, refinePostIdeas, type CallIdeas, type IdeasContent, type ReadCommits } from "@/lib/ai/post-ideas";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const roomy: AiLimits = { userMonthlyUsd: 1000, globalMonthlyUsd: 100000, userDailyTurns: 1000 };
const base = 9_100_000_000 + Math.floor(Math.random() * 1_000_000) * 10;
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
// 原文に入っている目印。保存されていないことを確かめる
const SECRET_MESSAGE = "fix: 原文の目印-7f3a 通知が 2 回届く";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const usage = { inputTokens: 15000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 4000 };
const ideasOutput = {
  ideas: [
    { pillar: "詰まった・直した", title: "通知が 2 回届く", angle: "誠実さが伝わる", commits: [{ sha: SHA.slice(0, 7), note: "通知の重複を直した" }], drafts: [{ sns: "x", text: "通知が 2 回届く不具合を直しました。" }, { sns: "threads", text: "長めの文" }] },
    { pillar: "なぜそう作ったか", title: "撮るだけにした理由", angle: "", commits: [], drafts: [{ sns: "x", text: "入力を減らしたかった" }] },
  ],
  questions: [{ question: "何に詰まりましたか？", choices: ["時差", "二重送信"] }],
};
const caller = (output: unknown = ideasOutput, stopReason = "end_turn"): CallIdeas => vi.fn(async () => ({ output, stopReason, model: "claude-opus-5-5", usage }));
const commits: ReadCommits = vi.fn(async () => ({
  commits: [{ sha: SHA, date: "2026-10-10T00:00:00Z", message: SECRET_MESSAGE, files: [{ path: "src/notify.ts", status: "modified", additions: 3, deletions: 1 }], patch: "+if (!sent) send()", patchTruncated: false }],
  truncated: false,
}));
const deps = (over: Partial<Parameters<typeof generatePostIdeas>[2]> = {}) => ({ callIdeas: caller(), readCommits: commits, limits: roomy, ...over });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和" }).select("id").single()).data!.id;
  await admin.from("github_installations").insert({ owner_id: aliceId, installation_id: base + 1, account_login: "alice" });
  await admin.from("project_github_repos").insert({ project_id: projectId, owner_id: aliceId, installation_id: base + 1, repo_id: 42, full_name: "alice/kakeibo" });
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

async function latestIdeas(threadId: string) {
  const { data } = await alice.from("ai_messages").select("id, role, content").eq("thread_id", threadId).order("created_at").order("id");
  const last = [...data!].reverse().find((m) => m.role === "assistant")!;
  return { id: last.id, content: last.content as unknown as IdeasContent, all: data! };
}

describe("投稿のネタ", () => {
  let threadId: string;

  it("コミットを読んでネタを出し、会話に残す。コミットの原文は保存しない。利用量を数える", async () => {
    const d = deps();
    const r = await generatePostIdeas(alice, admin, d, { userId: aliceId, projectId, days: 7, sns: ["x", "threads", "note"] });
    expect(r.ok).toBe(true);
    threadId = (r as { threadId: string }).threadId;
    // AI にはコミットを渡している
    expect(JSON.stringify(vi.mocked(d.callIdeas).mock.calls[0][0].messages)).toContain("原文の目印-7f3a");

    const { content, all } = await latestIdeas(threadId);
    expect(content.ideas).toHaveLength(2);
    expect(content.ideas[0].commits[0].sha).toBe(SHA);
    expect(all[0].content).toMatchObject({ kind: "ideas_request", days: 7, sns: ["x", "threads"], repo: "alice/kakeibo", commitCount: 1 });
    expect(JSON.stringify(all)).not.toContain("原文の目印-7f3a");
    expect(JSON.stringify(all)).not.toContain("if (!sent)");

    const { data: u } = await admin.from("ai_usage").select("purpose, thread_id").eq("owner_id", aliceId);
    expect(u).toEqual([{ purpose: "post_ideas", thread_id: threadId }]);
  });

  it("他人はネタの会話を読めず、ネタを下書きにすることもできない", async () => {
    expect((await bob.from("ai_threads").select("id").eq("id", threadId)).data).toEqual([]);
    expect((await bob.from("ai_messages").select("id").eq("thread_id", threadId)).data).toEqual([]);
    const { id } = await latestIdeas(threadId);
    const r = await adoptPostIdea(bob, admin, { userId: bobId, projectId, messageId: id, index: 0, accounts: {} });
    expect(r.ok).toBe(false);
    // 本人でも、画面側からはネタの会話を書き換えられない
    await alice.from("ai_messages").update({ content: { kind: "ideas", ideas: [], questions: [], adopted: {} } }).eq("id", id);
    expect((await latestIdeas(threadId)).content.ideas).toHaveLength(2);
  });

  it("質問に答えると、コミットを読み直さずに出し直す。知らない sha は捨てる", async () => {
    vi.mocked(commits).mockClear();
    const d = caller({ ...ideasOutput, ideas: [{ ...ideasOutput.ideas[0], commits: [{ sha: SHA.slice(0, 8), note: "a" }, { sha: "ffffffff", note: "b" }] }], questions: [] });
    const r = await refinePostIdeas(alice, admin, { callIdeas: d, limits: roomy }, { userId: aliceId, projectId, threadId, answers: [{ question: "何に詰まりましたか？", answer: "時差の計算" }] });
    expect(r.ok).toBe(true);
    expect(commits).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(d).mock.calls[0][0].messages)).toContain("時差の計算");
    const { content } = await latestIdeas(threadId);
    expect(content.ideas[0].commits).toEqual([{ sha: SHA, note: "a" }]);
    expect(content.questions).toEqual([]);
  });

  it("他人の会話では出し直せない", async () => {
    const r = await refinePostIdeas(bob, admin, { callIdeas: caller(), limits: roomy }, { userId: bobId, projectId, threadId, answers: [{ question: "q", answer: "a" }] });
    expect(r.ok).toBe(false);
  });

  it("ネタを選ぶと、投稿の下書きになる。同じネタを 2 回選んでも、下書きは 1 つ", async () => {
    const { id } = await latestIdeas(threadId);
    const r = await adoptPostIdea(alice, admin, { userId: aliceId, projectId, messageId: id, index: 0, accounts: {} });
    expect(r.ok).toBe(true);
    const postId = (r as { postId: string }).postId;
    const { data: post } = await alice.from("posts").select("body, status, planned_at, post_targets(sns, body_override)").eq("id", postId).single();
    expect(post).toMatchObject({ body: "通知が 2 回届く不具合を直しました。", status: "draft", planned_at: null });
    expect(post!.post_targets).toHaveLength(2);
    expect(post!.post_targets.find((t) => t.sns === "threads")!.body_override).toBe("長めの文");

    expect((await latestIdeas(threadId)).content.adopted).toEqual({ "0": postId });
    const again = await adoptPostIdea(alice, admin, { userId: aliceId, projectId, messageId: id, index: 0, accounts: {} });
    expect(again).toEqual({ ok: true, postId });
    expect((await alice.from("posts").select("id").eq("project_id", projectId)).data).toHaveLength(1);
  });

  it("コミットがない、上限に達した、AI の返事が使えないときは、会話を残さない", async () => {
    const before = (await alice.from("ai_threads").select("id")).data!.length;
    const none = await generatePostIdeas(alice, admin, deps({ readCommits: async () => ({ commits: [], truncated: false }) }), { userId: aliceId, projectId, days: 3, sns: ["x"] });
    expect(none).toMatchObject({ ok: false });
    vi.mocked(commits).mockClear();
    const over = await generatePostIdeas(alice, admin, deps({ limits: { ...roomy, userMonthlyUsd: 0.000001 } }), { userId: aliceId, projectId, days: 7, sns: ["x"] });
    expect(over).toMatchObject({ ok: false });
    expect(commits).not.toHaveBeenCalled();
    const bad = await generatePostIdeas(alice, admin, deps({ callIdeas: caller({ ideas: [] }) }), { userId: aliceId, projectId, days: 7, sns: ["x"] });
    expect(bad).toMatchObject({ ok: false });
    expect((await alice.from("ai_threads").select("id")).data).toHaveLength(before);
    // 使えなかった返事の分も数える
    const { data: u } = await admin.from("ai_usage").select("thread_id").eq("owner_id", aliceId).is("thread_id", null);
    expect(u).toHaveLength(1);
  });

  it(`ネタの会話は新しい ${KEEP_IDEA_THREADS} 回分だけ残す。下書きにした投稿は残る`, async () => {
    for (let i = 0; i < KEEP_IDEA_THREADS; i++) {
      expect((await generatePostIdeas(alice, admin, deps(), { userId: aliceId, projectId, days: 7, sns: ["x"] })).ok).toBe(true);
    }
    const { data: threads } = await alice.from("ai_threads").select("id").eq("purpose", "post_ideas");
    expect(threads).toHaveLength(KEEP_IDEA_THREADS);
    expect(threads!.map((t) => t.id)).not.toContain(threadId);
    expect((await alice.from("posts").select("id").eq("project_id", projectId)).data).toHaveLength(1);
  });

  it("他人のプロジェクトでは出せない（リポジトリも読まない）", async () => {
    vi.mocked(commits).mockClear();
    const r = await generatePostIdeas(bob, admin, deps(), { userId: bobId, projectId, days: 7, sns: ["x"] });
    expect(r).toMatchObject({ ok: false });
    expect(commits).not.toHaveBeenCalled();
  });
});
