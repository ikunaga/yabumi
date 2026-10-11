// AI っぽさチェックの流れ（利用量の記録、上限、他人のプロジェクト）。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runAiCheck, type CallCheck } from "@/lib/ai/ai-check";
import type { AiLimits } from "@/lib/ai/limits";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const roomy: AiLimits = { userMonthlyUsd: 1000, globalMonthlyUsd: 1_000_000, userDailyTurns: 100_000 };
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const usage = { inputTokens: 2500, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 800 };
const caller = (output: unknown, stopReason = "end_turn"): CallCheck => vi.fn(async () => ({ output, stopReason, model: "claude-opus-5-5", usage }));
const texts = [{ sns: "x" as const, text: "通知を直しました。いかがでしたか" }];

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("AI っぽさチェック", () => {
  it("指摘を返し、利用量を ai_check として記録する（結果は保存しない）", async () => {
    const call = caller({ summary: "短くてよいです", findings: [{ sns: "x", kind: "cliche", quote: "いかがでしたか", why: "決まり文句です", fix: "" }] });
    const r = await runAiCheck(alice, admin, { callCheck: call, limits: roomy }, { userId: aliceId, projectId, texts });
    expect(r).toMatchObject({ ok: true, result: { findings: [{ kind: "cliche", quote: "いかがでしたか" }] } });
    expect(JSON.stringify(vi.mocked(call).mock.calls[0][0].messages)).toContain("いかがでしたか");
    const { data } = await admin.from("ai_usage").select("purpose, thread_id").eq("owner_id", aliceId);
    expect(data).toEqual([{ purpose: "ai_check", thread_id: null }]);
    expect((await alice.from("ai_threads").select("id")).data).toEqual([]);
  });

  it("上限に達していたら AI を呼ばない", async () => {
    const call = caller({ summary: "", findings: [] });
    const r = await runAiCheck(alice, admin, { callCheck: call, limits: { ...roomy, userMonthlyUsd: 0.000001 } }, { userId: aliceId, projectId, texts });
    expect(r.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("他人のプロジェクトでは確かめられない。空の文面や長すぎる文面は AI を呼ばない", async () => {
    const call = caller({ summary: "", findings: [] });
    expect((await runAiCheck(bob, admin, { callCheck: call, limits: roomy }, { userId: bobId, projectId, texts })).ok).toBe(false);
    expect((await runAiCheck(alice, admin, { callCheck: call, limits: roomy }, { userId: aliceId, projectId, texts: [{ sns: "x", text: "  " }] })).ok).toBe(false);
    expect((await runAiCheck(alice, admin, { callCheck: call, limits: roomy }, { userId: aliceId, projectId, texts: [{ sns: "x", text: "あ".repeat(5001) }] })).ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("形の合わない返事・断られたときはエラーにするが、使った分は数える", async () => {
    const before = (await admin.from("ai_usage").select("id").eq("owner_id", aliceId)).data!.length;
    expect((await runAiCheck(alice, admin, { callCheck: caller({ x: 1 }), limits: roomy }, { userId: aliceId, projectId, texts })).ok).toBe(false);
    expect((await runAiCheck(alice, admin, { callCheck: caller(null, "refusal"), limits: roomy }, { userId: aliceId, projectId, texts })).ok).toBe(false);
    expect((await admin.from("ai_usage").select("id").eq("owner_id", aliceId)).data).toHaveLength(before + 2);
  });
});
