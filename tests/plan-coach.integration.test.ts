// AI と進めるアカウント設計（会話・案の採用・上限）と、AI まわりのテーブルの RLS。
// AI は callModel をモックし、本物の Claude API は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiLimits } from "@/lib/ai/limits";
import { coachStep, type CallModel, type ModelResult } from "@/lib/ai/plan-coach";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const roomy: AiLimits = { userMonthlyUsd: 1000, globalMonthlyUsd: 100000, userDailyTurns: 1000 };
const usage = { inputTokens: 1000, cacheWriteTokens: 2000, cacheReadTokens: 3000, outputTokens: 500 };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const reply = (turn: unknown, extra: Partial<ModelResult> = {}): CallModel =>
  vi.fn(async () => ({ turn, stopReason: "end_turn", model: "claude-opus-5-5", usage, ...extra }));

const question = { message: "まず、何を広めたいですか？", choices: ["アプリ", "自分"], proposal: null };
const pillarsProposal = {
  message: "投稿の柱の案です。どれかを選ぶか、直したいところを教えてください。",
  choices: [],
  proposal: {
    section: "pillars",
    options: [
      { title: "開発日記", summary: "開発で溜まるものを柱に", pros: ["ネタ切れしにくい"], cons: ["宣伝は少なめ"], value_json: JSON.stringify({ items: [{ name: "詰まった・直した", share: 40, example: "" }, { name: "なぜそう作ったか", share: 30, example: "" }], tone: "です・ます", avoid: "宣伝だけの投稿を続けない（使う人は増えないため）" }) },
      { title: "お役立ち中心", summary: "家計のコツ", pros: ["広がりやすい"], cons: ["ネタを探す手間"], value_json: JSON.stringify({ items: [{ name: "お金のコツ", share: 60, example: "" }], tone: "", avoid: "" }) },
    ],
    recommended: 0,
    reason: "運用の手間を減らしたいという目的に合うため",
  },
};

const step = (client: TestClient, userId: string, callModel: CallModel, threadId: string | null, input: Parameters<typeof coachStep>[3]["input"], limits = roomy) =>
  coachStep(client, admin, { callModel, limits }, { userId, projectId, threadId, input });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和", description: "家計簿アプリ", target_audience: "28 歳の会社員" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("AI と進めるアカウント設計", () => {
  let threadId: string;

  it("相談を始めると、会話を作り、AI の返事と利用量を記録する", async () => {
    const callModel = reply(question);
    const r = await step(alice, aliceId, callModel, null, { kind: "start", focus: null });
    expect(r.ok).toBe(true);
    threadId = r.threadId!;

    // AI にはプロジェクトの情報が最初から渡る（同じことを二度聞かないため）
    const req = vi.mocked(callModel).mock.calls[0][0];
    expect(JSON.stringify(req.messages)).toContain("家計簿アプリ");
    expect(JSON.stringify(req.messages)).toContain("28 歳の会社員");

    const { data: msgs } = await alice.from("ai_messages").select("role, content").eq("thread_id", threadId).order("created_at");
    expect(msgs!.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs![1].content).toMatchObject({ message: "まず、何を広めたいですか？", adopted: null });

    const { data: u } = await alice.from("ai_usage").select("model, output_tokens, cost_usd").eq("thread_id", threadId);
    expect(u).toHaveLength(1);
    expect(u![0]).toMatchObject({ model: "claude-opus-5-5", output_tokens: 500 });
    expect(Number(u![0].cost_usd)).toBeGreaterThan(0);
  });

  it("答えると履歴ごと AI に渡り、案が返る", async () => {
    const callModel = reply(pillarsProposal);
    const r = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "アプリを広めたいです" });
    expect(r.ok).toBe(true);
    const req = vi.mocked(callModel).mock.calls[0][0];
    expect(req.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "system"]);
  });

  it("案を採用すると、その案だけが「AI の案から」として設計に保存される", async () => {
    const { data: msgs } = await alice.from("ai_messages").select("id, content").eq("thread_id", threadId).eq("role", "assistant").order("created_at");
    const proposalMsg = msgs![msgs!.length - 1];

    const callModel = reply(question);
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: proposalMsg.id, optionIndex: 0 });
    expect(r.ok).toBe(true);

    const { data: plan } = await alice.from("account_plans").select("data, section_sources").eq("project_id", projectId).single();
    expect((plan!.data as Record<string, { items: { name: string }[] }>).pillars.items.map((i) => i.name)).toEqual(["詰まった・直した", "なぜそう作ったか"]);
    expect(plan!.section_sources).toEqual({ pillars: "ai" });

    const { data: adopted } = await alice.from("ai_messages").select("content").eq("id", proposalMsg.id).single();
    expect((adopted!.content as { adopted: number }).adopted).toBe(0);

    // AI には採用したことと、更新後の設計が渡る
    const req = vi.mocked(callModel).mock.calls[0][0];
    expect(JSON.stringify(req.messages)).toContain("採用して保存しました");
    expect(JSON.stringify(req.messages)).toContain("決定（AI の案を採用）");
  });

  it("ない案は採用できない", async () => {
    const { data: msgs } = await alice.from("ai_messages").select("id").eq("thread_id", threadId).eq("role", "assistant").order("created_at");
    const r = await step(alice, aliceId, reply(question), threadId, { kind: "adopt", messageId: msgs![0].id, optionIndex: 1 });
    expect(r.ok).toBe(false);
  });

  it("AI が断ったときは、利用量だけ記録し、発言も返事も残さない", async () => {
    const before = (await alice.from("ai_messages").select("id").eq("thread_id", threadId)).data!.length;
    const usageBefore = (await admin.from("ai_usage").select("id").eq("thread_id", threadId)).data!.length;
    const r = await step(alice, aliceId, reply(null, { stopReason: "refusal" }), threadId, { kind: "text", text: "こんにちは" });
    expect(r.ok).toBe(false);
    expect((await alice.from("ai_messages").select("id").eq("thread_id", threadId)).data!.length).toBe(before);
    expect((await admin.from("ai_usage").select("id").eq("thread_id", threadId)).data!.length).toBe(usageBefore + 1);
  });

  it("形の合わない返事はエラーにし、送った発言を残さない（送り直しで重ならない）", async () => {
    const before = (await alice.from("ai_messages").select("id").eq("thread_id", threadId)).data!.length;
    const r = await step(alice, aliceId, reply({ nope: true }), threadId, { kind: "text", text: "こんにちは" });
    expect(r).toMatchObject({ ok: false });
    expect((await alice.from("ai_messages").select("id").eq("thread_id", threadId)).data!.length).toBe(before);
  });

  it("AI の呼び出しが失敗しても、送った発言を残さない", async () => {
    const before = (await alice.from("ai_messages").select("id").eq("thread_id", threadId)).data!.length;
    const callModel: CallModel = vi.fn(async () => {
      throw new Error("400 compiled grammar is too large");
    });
    const r = await step(alice, aliceId, callModel, threadId, { kind: "focus", focus: "pillars" });
    expect(r).toMatchObject({ ok: false, threadId });
    expect((await alice.from("ai_messages").select("id").eq("thread_id", threadId)).data!.length).toBe(before);
  });

  it("新しい会話の最初で失敗したら、会話ごと残さない", async () => {
    const threadsBefore = (await alice.from("ai_threads").select("id")).data!.length;
    const r = await step(alice, aliceId, reply(null, { stopReason: "max_tokens" }), null, { kind: "start", focus: "goal" });
    expect(r).toMatchObject({ ok: false, threadId: null });
    expect((await alice.from("ai_threads").select("id")).data!.length).toBe(threadsBefore);
  });

  it("案の中身が形に合わなければ 1 回だけ言い直させ、直った案を残す", async () => {
    const broken = { ...pillarsProposal, proposal: { ...pillarsProposal.proposal, options: [{ ...pillarsProposal.proposal.options[0], value_json: "{oops" }] } };
    const callModel = vi
      .fn<CallModel>()
      .mockResolvedValueOnce({ turn: broken, stopReason: "end_turn", model: "claude-opus-5-5", usage })
      .mockResolvedValueOnce({ turn: pillarsProposal, stopReason: "end_turn", model: "claude-opus-5-5", usage });
    const r = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "柱の案をください" });
    expect(r.ok).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
    // 言い直しの依頼には、どこが合わなかったかを書く
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[1][0].messages.at(-1))).toContain("JSON として読めません");
    const { data } = await alice.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).single();
    expect((data!.content as { proposal: { options: unknown[] } }).proposal.options).toHaveLength(2);
    // 2 回分の利用量を数える
    const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("thread_id", threadId);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("長すぎる発言は AI に送らない", async () => {
    const callModel = reply(question);
    const r = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "あ".repeat(2001) });
    expect(r.ok).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("今月の上限を超えたら AI を呼ばない（利用者ごと・全体）", async () => {
    const callModel = reply(question);
    const r1 = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "続き" }, { ...roomy, userMonthlyUsd: 0.000001 });
    expect(r1).toMatchObject({ ok: false });
    expect((r1 as { message: string }).message).toContain("今月");
    const r2 = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "続き" }, { ...roomy, globalMonthlyUsd: 0.000001 });
    expect((r2 as { message: string }).message).toContain("全体");
    const r3 = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "続き" }, { ...roomy, userDailyTurns: 1 });
    expect((r3 as { message: string }).message).toContain("今日");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("他人は、人の会話を続けられない", async () => {
    const callModel = reply(question);
    const r = await coachStep(bob, admin, { callModel, limits: roomy }, { userId: bobId, projectId, threadId, input: { kind: "text", text: "のぞき見" } });
    expect(r.ok).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe("AI まわりのテーブルの RLS", () => {
  it("本人は自分の会話・発言・利用量を読める。他人は読めない", async () => {
    expect((await alice.from("ai_threads").select("id")).data!.length).toBeGreaterThan(0);
    expect((await alice.from("ai_messages").select("id")).data!.length).toBeGreaterThan(0);
    expect((await alice.from("ai_usage").select("id")).data!.length).toBeGreaterThan(0);
    expect((await bob.from("ai_threads").select("id")).data).toEqual([]);
    expect((await bob.from("ai_messages").select("id")).data).toEqual([]);
    expect((await bob.from("ai_usage").select("id")).data).toEqual([]);
  });

  it("本人でも、会話を作ったり AI の返事を偽造したりできない", async () => {
    const { error: e1 } = await alice.from("ai_threads").insert({ owner_id: aliceId, project_id: projectId, purpose: "account_plan" });
    expect(e1).not.toBeNull();
    const { data: t } = await alice.from("ai_threads").select("id").limit(1).single();
    const { error: e2 } = await alice.from("ai_messages").insert({ thread_id: t!.id, owner_id: aliceId, role: "assistant", content: { message: "偽物" } });
    expect(e2).not.toBeNull();
  });

  it("本人でも、利用量を消したり書き換えたりできない（上限をすり抜けられない）", async () => {
    const before = (await alice.from("ai_usage").select("id, cost_usd")).data!;
    await alice.from("ai_usage").delete().eq("owner_id", aliceId);
    await alice.from("ai_usage").update({ cost_usd: 0 }).eq("owner_id", aliceId);
    const after = (await alice.from("ai_usage").select("id, cost_usd")).data!;
    expect(after).toEqual(before);
  });

  it("プロジェクトを消しても、利用量は残る", async () => {
    const p = (await alice.from("projects").insert({ name: "消すプロジェクト" }).select("id").single()).data!.id;
    const { data: t } = await admin.from("ai_threads").insert({ owner_id: aliceId, project_id: p, purpose: "account_plan" }).select("id").single();
    await admin.from("ai_usage").insert({ owner_id: aliceId, thread_id: t!.id, purpose: "account_plan", model: "claude-opus-5-5", cost_usd: 0.01 });
    await alice.from("projects").delete().eq("id", p);
    const { data } = await admin.from("ai_usage").select("thread_id").eq("owner_id", aliceId).eq("cost_usd", 0.01);
    expect(data).toEqual([{ thread_id: null }]);
  });
});
