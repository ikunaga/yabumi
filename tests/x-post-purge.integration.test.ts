// X で人気の投稿から出したネタの会話の、他人の投稿の文の控えを 1 日ほどで消す（セキュリティ確認 2026-11-06 の L3。20261106190000_x_post_text_purge）。
// purge_expired_data は DB 全体に効くので、消した件数は確かめず、この利用者の行だけを見る。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { X_POST_TEXT_PURGED, refinePostIdeas } from "@/lib/ai/post-ideas";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let projectId: string;

const xPost = (text: string, interest = "") => ({ url: "https://x.com/someone/status/1850000000000000001", id: "1850000000000000001", text, interest });
const ideas = { kind: "ideas", ideas: [{ pillar: "p", title: "t", angle: "a", commits: [], notes: [], drafts: [{ sns: "x", text: "朝 6 時半の話" }] }], questions: [], adopted: {} };

async function thread(createdAt: string, text: string, interest = "") {
  const t = (await admin.from("ai_threads").insert({ owner_id: aliceId, project_id: projectId, purpose: "post_ideas" }).select("id").single()).data!.id;
  const m = (await admin.from("ai_messages").insert({ thread_id: t, owner_id: aliceId, role: "user", content: { kind: "ideas_request", source: "x_post", sns: ["x"], xPost: xPost(text, interest) }, created_at: createdAt }).select("id").single()).data!.id;
  await admin.from("ai_messages").insert({ thread_id: t, owner_id: aliceId, role: "assistant", content: ideas, created_at: createdAt });
  return { threadId: t, messageId: m };
}
const contentOf = async (id: string) => (await admin.from("ai_messages").select("content").eq("id", id).single()).data!.content as { xPost: ReturnType<typeof xPost> };

scopeAiBudget();
beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "こむぎ日和" }).select("id").single()).data!.id;
});
afterAll(async () => {
  await admin.from("ai_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
});

describe("X の投稿の文の控え", () => {
  it("作ってから 24 時間を過ぎた控えは、文と気になったところを空にし、URL と id は残す。新しい控えは残す", async () => {
    const old = await thread(new Date(Date.now() - 25 * 3600_000).toISOString(), "朝 6 時、店の前の道がいちばんいい匂い", "書き出し");
    const fresh = await thread(new Date(Date.now() - 2 * 3600_000).toISOString(), "新しい投稿の文");
    expect((await admin.rpc("purge_expired_data")).error).toBeNull();
    expect((await contentOf(old.messageId)).xPost).toEqual({ url: "https://x.com/someone/status/1850000000000000001", id: "1850000000000000001", text: "", interest: "" });
    expect((await contentOf(fresh.messageId)).xPost.text).toBe("新しい投稿の文");
    // AI の返事（ネタの案）は残る
    const { data: replies } = await admin.from("ai_messages").select("content").eq("thread_id", old.threadId).eq("role", "assistant");
    expect(replies).toHaveLength(1);
  });

  it("消えたあとは、AI を呼ばずに貼り直すよう知らせる", async () => {
    const { threadId } = await thread(new Date(Date.now() - 25 * 3600_000).toISOString(), "消える文");
    await admin.rpc("purge_expired_data");
    const callIdeas = vi.fn();
    const r = await refinePostIdeas(alice, admin, { callIdeas }, { userId: aliceId, projectId, threadId, answers: [{ question: "q", answer: "a" }] });
    expect(r).toEqual({ ok: false, message: X_POST_TEXT_PURGED });
    expect(callIdeas).not.toHaveBeenCalled();
  });

  it("利用者は片付けの関数を呼べない", async () => {
    expect((await alice.rpc("purge_expired_data")).error).not.toBeNull();
  });
});
