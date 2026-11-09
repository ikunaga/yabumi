// 書き方（文調のメモ。docs/design/voice-from-posts.md の 2〜4）: 材料の選び方（送った・本人が書いた投稿だけ）、例の投稿の絞り込み、
// 書き方を読み取る AI の流れ（5 本から・1 日 3 回・会話や記録を消しても回数は戻らない）。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runVoiceMemo, type CallVoiceMemo } from "@/lib/ai/voice-memo";
import { saveSectionValue } from "@/lib/plan/save";
import { sectionSchemas } from "@/lib/plan/schema";
import { allowedVoiceExamples, loadVoiceExampleHeads, loadVoiceExamples, loadVoiceMaterial } from "@/lib/plan/voice";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;
const ids: Record<string, string> = {};

const usage = { inputTokens: 9000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 800 };
const memoOut = { length: "1 文は短め", endings: "です・ます", emoji: "行頭に 1 つ", phrases: "『焼きたてです』", linebreaks: "1 文ごとに改行", hashtags: "最後に 1 つ", other: "", conflicts: ["口調は絵文字なし、実際は多い"], examples: [1, 1, 2, 99] };
const caller = (output: unknown = memoOut): CallVoiceMemo => vi.fn(async () => ({ output, stopReason: "end_turn", model: "claude-opus-5-5", usage }));

scopeAiBudget();

async function post(owner: string, project: string, key: string, body: string, opts: { origin?: "self" | "ai" | null; published?: boolean; sns?: string[]; at?: string } = {}) {
  const { data: p, error } = await admin.from("posts").insert({ project_id: project, owner_id: owner, body, status: "scheduled", planned_at: new Date().toISOString(), text_origin: opts.origin === undefined ? "self" : opts.origin }).select("id").single();
  if (error) throw error;
  const rows = (opts.sns ?? ["x"]).map((sns) => ({ post_id: p.id, owner_id: owner, sns, status: opts.published === false ? "pending" : "published", published_at: opts.published === false ? null : (opts.at ?? new Date().toISOString()) }));
  const { data: ts, error: e2 } = await admin.from("post_targets").insert(rows).select("id, sns");
  if (e2) throw e2;
  ids[key] = ts[0].id;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "こむぎ日和" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "ほかの店" }).select("id").single()).data!.id;
  for (let i = 1; i <= 4; i++) await post(aliceId, projectId, `self${i}`, `自分で書いた投稿 ${i} 本目です🍞\n焼きたてです。`, { at: `2026-11-0${i}T03:00:00Z` });
  await post(aliceId, projectId, "legacy", "前からある投稿です", { origin: null, at: "2026-11-05T03:00:00Z" });
  await post(aliceId, projectId, "twice", "2 つの SNS に送った投稿", { sns: ["x", "threads"], at: "2026-11-06T03:00:00Z" });
  await post(aliceId, projectId, "ai", "AI の文をもとにした投稿", { origin: "ai" });
  await post(aliceId, projectId, "draft", "まだ送っていない投稿", { published: false });
  await post(bobId, bobProject, "bob", "ほかの人の投稿");
});

afterAll(async () => {
  await admin.from("ai_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("材料と例の投稿", () => {
  it("材料は、このプロジェクトの、送った、本人が書いた投稿だけ（前からある null も入る。AI の文・送っていない投稿・ほかの人の投稿は入らない。同じ本文は 1 本）", async () => {
    const m = await loadVoiceMaterial(alice, projectId);
    expect(m).toHaveLength(6);
    expect(m.map((x) => x.text)).not.toContain("AI の文をもとにした投稿");
    expect(m.map((x) => x.text)).not.toContain("まだ送っていない投稿");
    expect(m.filter((x) => x.text === "2 つの SNS に送った投稿")).toHaveLength(1);
    expect(m.map((x) => x.text)).toContain("前からある投稿です");
    expect(await loadVoiceMaterial(bob, projectId)).toEqual([]);
  });

  it("例の投稿として保存できるのは、材料に入る投稿だけ（ほかの人・AI の文・送っていない投稿の id は外す。3 本まで）", async () => {
    expect(await allowedVoiceExamples(alice, projectId, [ids.self1, ids.bob, ids.ai, ids.draft, ids.self2, ids.self3, ids.self4])).toEqual([ids.self1, ids.self2, ids.self3]);
    const value = { ...sectionSchemas.voice.parse({}), memo: { ...sectionSchemas.voice.parse({}).memo, endings: "です・ます" }, examples: [ids.bob, ids.self1, ids.ai] };
    expect((await saveSectionValue(alice, projectId, "voice", value, "manual")).ok).toBe(true);
    const { data } = await alice.from("account_plans").select("data").eq("project_id", projectId).single();
    expect((data!.data as { voice: { examples: string[] } }).voice.examples).toEqual([ids.self1]);
    // AI に渡すときも本人の権限で読むので、ほかの人の投稿は読めない
    expect(await loadVoiceExamples(alice, projectId, [ids.bob, ids.self1])).toEqual([{ sns: "x", text: expect.stringContaining("1 本目") }]);
    // 書き方の欄に出す例の頭も、本人が書いて送った投稿だけ
    const heads = await loadVoiceExampleHeads(alice, projectId, [ids.bob, ids.ai, ids.self1]);
    expect(Object.keys(heads)).toEqual([ids.self1]);
    expect(heads[ids.self1]).toContain("1 本目");
  });
});

describe("書き方を読み取る AI", () => {
  it("書き方の案を返し、利用量を voice_memo として記録する。例の番号は材料の配信先に直す（重なり・範囲外は捨てる）", async () => {
    const call = caller();
    const r = await runVoiceMemo(alice, admin, { callVoiceMemo: call }, { userId: aliceId, projectId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceCount).toBe(6);
    expect(r.draft.memo.endings).toBe("です・ます");
    expect(r.draft.conflicts).toEqual(["口調は絵文字なし、実際は多い"]);
    const material = await loadVoiceMaterial(alice, projectId);
    expect(r.draft.examples).toEqual([material[0].targetId, material[1].targetId]);
    const sent = JSON.stringify(vi.mocked(call).mock.calls[0][0]);
    expect(sent).toContain("# 数えた値");
    expect(sent).not.toContain("AI の文をもとにした投稿");
    const { data: u } = await admin.from("ai_usage").select("purpose").eq("owner_id", aliceId).eq("purpose", "voice_memo");
    expect(u).toHaveLength(1);
  });

  it("材料が 5 本に足りないとき（外したとき）は呼ばない", async () => {
    const call = caller();
    const r = await runVoiceMemo(alice, admin, { callVoiceMemo: call }, { userId: aliceId, projectId, exclude: [ids.self1, ids.self2] });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("5 本たまると") });
    expect(call).not.toHaveBeenCalled();
  });

  it("1 日 3 回まで。利用者は利用量の記録も会話も消せないので、消して数え直せない", async () => {
    await runVoiceMemo(alice, admin, { callVoiceMemo: caller() }, { userId: aliceId, projectId });
    await runVoiceMemo(alice, admin, { callVoiceMemo: caller() }, { userId: aliceId, projectId });
    const call = caller();
    expect(await runVoiceMemo(alice, admin, { callVoiceMemo: call }, { userId: aliceId, projectId })).toMatchObject({ ok: false, message: expect.stringContaining("1 日 3 回") });
    expect(call).not.toHaveBeenCalled();
    // 利用者が自分の記録や会話を消そうとしても、回数は戻らない
    await alice.from("ai_usage").delete().eq("owner_id", aliceId);
    await alice.from("ai_threads").delete().eq("owner_id", aliceId);
    const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("owner_id", aliceId).eq("purpose", "voice_memo");
    expect(count).toBe(3);
    expect((await runVoiceMemo(alice, admin, { callVoiceMemo: call }, { userId: aliceId, projectId })).ok).toBe(false);
  });

  it("同時に 5 回予約しても、1 日 3 回までしか通らない（判定は予約の lock の中）", async () => {
    const { userId: carolId } = await signUpNewUser();
    try {
      const reserve = () =>
        admin.rpc("reserve_ai_usage", { p_owner_id: carolId, p_purpose: "voice_memo", p_cost_usd: 0.15, p_scope_owner: carolId, p_as_of: "2100-01-01T00:00:00Z" }).then((r) => r.data?.[0]?.status);
      const statuses = await Promise.all(Array.from({ length: 5 }, reserve));
      expect(statuses.filter((x) => x === "ok")).toHaveLength(3);
      expect(statuses.filter((x) => x === "voice_memo_limit")).toHaveLength(2);
    } finally {
      await admin.from("ai_usage").delete().eq("owner_id", carolId);
      await deleteUser(carolId);
    }
  });

  it("ほかの人のプロジェクトでは読めない", async () => {
    expect((await runVoiceMemo(bob, admin, { callVoiceMemo: caller() }, { userId: bobId, projectId })).ok).toBe(false);
  });
});
