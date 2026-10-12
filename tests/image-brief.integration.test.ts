// 画像の文字の案の流れ（利用量の記録、上限、他人のプロジェクト）。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runImageBrief, type CallBrief } from "@/lib/ai/image-brief";
import type { AiLimits } from "@/lib/ai/limits";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const roomy: AiLimits = { userMonthlyUsd: 1000, globalMonthlyUsd: 1_000_000, userDailyTurns: 100_000 };
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const usage = { inputTokens: 1500, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 400 };
const caller = (output: unknown, stopReason = "end_turn"): CallBrief => vi.fn(async () => ({ output, stopReason, model: "claude-opus-5-5", usage }));
const good = {
  recommend: "card",
  reason: "お知らせなので",
  label: "新機能",
  headlines: ["通知の時間を選べます"],
  subline: "",
  diagram: { title: "通知", style: "points", items: [{ title: "朝", text: "予定" }] },
};
const text = "通知の時間を選べるようにしました。";

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("画像の文字の案", () => {
  it("案を返し、利用量を image_brief として記録する（案は保存しない）", async () => {
    const call = caller(good);
    const r = await runImageBrief(alice, admin, { callBrief: call, limits: roomy }, { userId: aliceId, projectId, text });
    expect(r).toMatchObject({ ok: true, brief: { recommend: "card", headlines: ["通知の時間を選べます"] } });
    expect(JSON.stringify(vi.mocked(call).mock.calls[0][0].messages)).toContain("通知の時間を選べるように");
    const { data } = await admin.from("ai_usage").select("purpose, thread_id").eq("owner_id", aliceId);
    expect(data).toEqual([{ purpose: "image_brief", thread_id: null }]);
  });

  it("上限に達していたら AI を呼ばない", async () => {
    const call = caller(good);
    const r = await runImageBrief(alice, admin, { callBrief: call, limits: { ...roomy, userMonthlyUsd: 0.000001 } }, { userId: aliceId, projectId, text });
    expect(r.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("他人のプロジェクト・空の本文・長すぎる本文では AI を呼ばない", async () => {
    const call = caller(good);
    expect((await runImageBrief(bob, admin, { callBrief: call, limits: roomy }, { userId: bobId, projectId, text })).ok).toBe(false);
    expect((await runImageBrief(alice, admin, { callBrief: call, limits: roomy }, { userId: aliceId, projectId, text: "  " })).ok).toBe(false);
    expect((await runImageBrief(alice, admin, { callBrief: call, limits: roomy }, { userId: aliceId, projectId, text: "あ".repeat(5001) })).ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("形の合わない返事・断られたときはエラーにするが、使った分は数える", async () => {
    const before = (await admin.from("ai_usage").select("id").eq("owner_id", aliceId)).data!.length;
    expect((await runImageBrief(alice, admin, { callBrief: caller({ x: 1 }), limits: roomy }, { userId: aliceId, projectId, text })).ok).toBe(false);
    expect((await runImageBrief(alice, admin, { callBrief: caller(null, "refusal"), limits: roomy }, { userId: aliceId, projectId, text })).ok).toBe(false);
    expect((await admin.from("ai_usage").select("id").eq("owner_id", aliceId)).data).toHaveLength(before + 2);
  });
});
