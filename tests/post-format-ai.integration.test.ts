// 投稿のフォーマットを AI とつくる流れ（docs/design/post-formats.md の 3）: 利用量を post_format で記録する、柱につなぐ、
// 1 人 1 日 10 回（同時でも、判定は予約の lock の中）、ほかの人のプロジェクトでは使えない。案は保存しない。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runPostFormatDraft, type CallPostFormat } from "@/lib/ai/post-format-ai";
import { saveSectionValue } from "@/lib/plan/save";
import { sectionSchemas } from "@/lib/plan/schema";
import { POST_FORMAT_DAILY_RUNS } from "@/lib/post-formats/schema";
import { addFormat } from "@/lib/post-formats/store";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const usage = { inputTokens: 3000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1200 };
const out = {
  proposals: [
    { name: "新メニューのお知らせ", purpose: "新しいものを出すとき", body: "【新メニュー】{何が}\n{いつから}から", example: "【新メニュー】栗のタルト", why: "先に何かがわかる" },
    { name: "今日のお店", purpose: "毎日", body: "{今日の様子}", example: "", why: "" },
  ],
};
const caller = (output: unknown = out): CallPostFormat => vi.fn(async () => ({ output, stopReason: "end_turn", model: "claude-opus-5-5", usage }));

scopeAiBudget();

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "こむぎ日和", product_type: "shop" }).select("id").single()).data!.id;
  const pillars = sectionSchemas.pillars.parse({ tone: "です・ます", items: [{ name: "新メニュー", share: 50, example: "" }] });
  expect((await saveSectionValue(alice, projectId, "pillars", pillars, "manual")).ok).toBe(true);
  await addFormat(alice, projectId, { name: "今日のお店", body: "{今日の様子}" });
});
afterAll(async () => {
  for (const id of [aliceId, bobId]) await admin.from("ai_usage").delete().eq("owner_id", id);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("投稿のフォーマットを AI とつくる", () => {
  it("案を返し（登録している名前は捨てる）、柱を選んだら案をその柱につなぐ。利用量を post_format として記録し、案は保存しない", async () => {
    const call = caller();
    const r = await runPostFormatDraft(alice, admin, { callPostFormat: call }, { userId: aliceId, projectId, kind: "新メニュー", must: "予約の案内" });
    expect(r).toMatchObject({ ok: true, proposals: [{ name: "新メニューのお知らせ", pillar: "新メニュー" }] });
    expect(r.ok && r.proposals).toHaveLength(1);
    const sent = JSON.stringify(vi.mocked(call).mock.calls[0][0].messages);
    expect(sent).toContain("<kind>新メニュー</kind>");
    expect(sent).toContain("- 今日のお店");
    const { data } = await admin.from("ai_usage").select("purpose").eq("owner_id", aliceId);
    expect(data).toEqual([{ purpose: "post_format" }]);
    expect((await admin.from("post_formats").select("id", { count: "exact", head: true }).eq("project_id", projectId)).count).toBe(1);
    // 柱でないものを選べば、柱につながない
    const r2 = await runPostFormatDraft(alice, admin, { callPostFormat: caller() }, { userId: aliceId, projectId, kind: "お店の日常" });
    expect(r2.ok && r2.proposals[0].pillar).toBe("");
  });

  it("何の投稿かが空なら、AI を呼ばずに断る。ほかの人のプロジェクトでは使えない", async () => {
    const call = caller();
    expect(await runPostFormatDraft(alice, admin, { callPostFormat: call }, { userId: aliceId, projectId, kind: "  " })).toMatchObject({ ok: false });
    expect(await runPostFormatDraft(bob, admin, { callPostFormat: call }, { userId: bobId, projectId, kind: "新メニュー" })).toMatchObject({ ok: false, message: "プロジェクトが見つかりません。" });
    expect(call).not.toHaveBeenCalled();
  });

  it(`1 日 ${POST_FORMAT_DAILY_RUNS} 回まで。同時に予約しても超えない（判定は予約の lock の中）`, async () => {
    const { userId: carolId } = await signUpNewUser();
    try {
      const reserve = () =>
        admin.rpc("reserve_ai_usage", { p_owner_id: carolId, p_purpose: "post_format", p_cost_usd: 0.12, p_scope_owner: carolId, p_as_of: "2100-01-01T00:00:00Z" }).then((r) => r.data?.[0]?.status);
      const statuses = await Promise.all(Array.from({ length: POST_FORMAT_DAILY_RUNS + 3 }, reserve));
      expect(statuses.filter((x) => x === "ok")).toHaveLength(POST_FORMAT_DAILY_RUNS);
      expect(statuses.filter((x) => x === "post_format_limit")).toHaveLength(3);
    } finally {
      await admin.from("ai_usage").delete().eq("owner_id", carolId);
      await deleteUser(carolId);
    }
  });

  it(`アプリの側でも、今日 ${POST_FORMAT_DAILY_RUNS} 回使っていれば AI を呼ばずに断る`, async () => {
    const rows = Array.from({ length: POST_FORMAT_DAILY_RUNS }, () => ({ owner_id: aliceId, purpose: "post_format", model: "test", cost_usd: 0.001, status: "done" }));
    expect((await admin.from("ai_usage").insert(rows)).error).toBeNull();
    const call = caller();
    expect(await runPostFormatDraft(alice, admin, { callPostFormat: call }, { userId: aliceId, projectId, kind: "新メニュー" })).toMatchObject({ ok: false, message: expect.stringContaining(`1 日 ${POST_FORMAT_DAILY_RUNS} 回まで`) });
    expect(call).not.toHaveBeenCalled();
  });
});
