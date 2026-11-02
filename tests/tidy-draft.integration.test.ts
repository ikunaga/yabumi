// AI で投稿に整える流れ（利用量の記録、上限、他人のプロジェクト、縮め直し）。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runTidyDraft, type CallTidy } from "@/lib/ai/tidy-draft";
import type { CallShorten } from "@/lib/ai/shorten";
import type { AiLimits } from "@/lib/ai/limits";
import { AI_UNAVAILABLE_MESSAGE, AiUnavailableError } from "@/lib/ai/provider-failure";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const roomy: AiLimits = { userMonthlyUsd: 1000, globalMonthlyUsd: 1_000_000, userDailyTurns: 100_000 };
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const usage = { inputTokens: 3000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1500 };
const caller = (output: unknown, stopReason = "end_turn"): CallTidy => vi.fn(async () => ({ output, stopReason, model: "claude-opus-5-5", usage }));
const good = {
  options: [
    { label: "そのまままとめる", why: "短く伝わる", drafts: [{ sns: "x", text: "通知の時間を選べるようにしました。" }] },
    { label: "問いかけで終える", why: "返事が来やすい", drafts: [{ sns: "x", text: "通知、何時に来てほしいですか？" }] },
  ],
};
const text = "えーと、通知の時間を、なんか選べるようにしたんですよ";
const purposes = async () => (await admin.from("ai_usage").select("purpose, thread_id").eq("owner_id", aliceId).order("created_at")).data!;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("AI で投稿に整える", () => {
  it("案を返し、利用量を tidy_draft として記録する（案は保存しない）", async () => {
    const call = caller(good);
    const r = await runTidyDraft(alice, admin, { callTidy: call, limits: roomy }, { userId: aliceId, projectId, text, sns: ["x", "note"] });
    expect(r).toMatchObject({ ok: true, options: [{ label: "そのまままとめる", drafts: [{ sns: "x" }] }, { label: "問いかけで終える" }] });
    const sent = JSON.stringify(vi.mocked(call).mock.calls[0][0].messages);
    expect(sent).toContain("なんか選べるように");
    expect(sent).toContain("かけいぼ日和");
    expect(await purposes()).toEqual([{ purpose: "tidy_draft", thread_id: null }]);
  });

  it("選んだ整え方を、AI への材料に入れる（形が合わない項目は受け取ったところでおまかせにしてある）", async () => {
    const call = caller(good);
    const r = await runTidyDraft(
      alice,
      admin,
      { callTidy: call, limits: roomy },
      { userId: aliceId, projectId, text, sns: ["x"], direction: { tone: "calm", length: "short", aim: "empathy", emoji: "some", note: "専門用語を使わないで" } },
    );
    expect(r.ok).toBe(true);
    const sent = JSON.stringify(vi.mocked(call).mock.calls[0][0].messages);
    expect(sent).toContain("落ち着いた口調");
    expect(sent).toContain("専門用語を使わないで");
  });

  it("上限を超えた案は 1 回縮めさせ、その分も tidy_draft として数える", async () => {
    const before = (await purposes()).length;
    const long = { options: [{ label: "a", why: "", drafts: [{ sns: "x", text: "あ".repeat(160) }] }] };
    const shorten: CallShorten = vi.fn(async () => ({ output: { drafts: [{ id: "0:x", text: "あ".repeat(120) }] }, stopReason: "end_turn", model: "claude-opus-5-5", usage }));
    const r = await runTidyDraft(alice, admin, { callTidy: caller(long), callShorten: shorten, limits: roomy }, { userId: aliceId, projectId, text, sns: ["x"] });
    expect(r).toMatchObject({ ok: true, options: [{ drafts: [{ sns: "x", text: "あ".repeat(120) }] }] });
    expect(shorten).toHaveBeenCalledTimes(1);
    const after = await purposes();
    expect(after).toHaveLength(before + 2);
    expect(after.slice(before).every((u) => u.purpose === "tidy_draft")).toBe(true);
  });

  it("上限に達していたら AI を呼ばない", async () => {
    const call = caller(good);
    const r = await runTidyDraft(alice, admin, { callTidy: call, limits: { ...roomy, userMonthlyUsd: 0.000001 } }, { userId: aliceId, projectId, text, sns: ["x"] });
    expect(r.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("他人のプロジェクト・空の本文・長すぎる本文・整えられる SNS がないときは AI を呼ばない", async () => {
    const call = caller(good);
    const run = (client: TestClient, userId: string, t: string, sns: string[]) => runTidyDraft(client, admin, { callTidy: call, limits: roomy }, { userId, projectId, text: t, sns });
    expect((await run(bob, bobId, text, ["x"])).ok).toBe(false);
    expect((await run(alice, aliceId, "  ", ["x"])).ok).toBe(false);
    expect((await run(alice, aliceId, "あ".repeat(3001), ["x"])).ok).toBe(false);
    expect((await run(alice, aliceId, text, ["note", "substack"])).ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("AI の支払い・鍵の問題で使えないときは「AI はいま使えません（運営者に知らせました）」と返し、ほかの失敗は時間をおいてと返す", async () => {
    const before = (await purposes()).length;
    const unavailable: CallTidy = vi.fn(async () => {
      throw new AiUnavailableError("anthropic", 402);
    });
    expect(await runTidyDraft(alice, admin, { callTidy: unavailable, limits: roomy }, { userId: aliceId, projectId, text, sns: ["x"] })).toEqual({
      ok: false,
      message: AI_UNAVAILABLE_MESSAGE.anthropic,
    });
    const broken: CallTidy = vi.fn(async () => {
      throw new Error("network");
    });
    const r = await runTidyDraft(alice, admin, { callTidy: broken, limits: roomy }, { userId: aliceId, projectId, text, sns: ["x"] });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.message).toContain("時間をおいて");
    // 返事がなかったので、利用量は数えない
    expect(await purposes()).toHaveLength(before);
  });

  it("形の合わない返事・断られたときはエラーにするが、使った分は数える", async () => {
    const before = (await purposes()).length;
    expect((await runTidyDraft(alice, admin, { callTidy: caller({ x: 1 }), limits: roomy }, { userId: aliceId, projectId, text, sns: ["x"] })).ok).toBe(false);
    expect((await runTidyDraft(alice, admin, { callTidy: caller(null, "refusal"), limits: roomy }, { userId: aliceId, projectId, text, sns: ["x"] })).ok).toBe(false);
    expect(await purposes()).toHaveLength(before + 2);
  });
});
