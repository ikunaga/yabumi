// 見本を指示で直す・この見本を最初の回にする（docs/design/auto-sample-image.md の 1.、20261119100000_auto_sample_instructions）。
// 偽の AI・偽のチェックで、サーバーの権限で通す。最後にテストの行が 0 件になることを確かめる
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { AutoPostGenerator, GenerateInput } from "@/lib/auto-post/ai";
import { adoptSample, makeSample, NO_PLAN_ID, purgeSamples, type EngineDeps } from "@/lib/auto-post/engine";
import { toPlan } from "@/lib/auto-post/plan-row";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let threadsAccount: string;
let xAccount: string;

const inputs: GenerateInput[] = [];
let n = 0;
const generator: AutoPostGenerator = vi.fn(async (input) => {
  inputs.push(input);
  n++;
  return { ok: true as const, texts: Object.fromEntries(input.sns.map((s: string) => [s, `${input.materialLabel.replace(/^メモ: /, "")}の話 ${n}`])), pillar: "", concern: "none" };
});
let findings: { sns: string; kind: string; quote: string; why: string; fix: string }[] = [];
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 } }));
const deps = (): EngineDeps => ({ generator, callCheck });

const projects: string[] = [];
async function project() {
  const { data, error } = await alice.from("projects").insert({ name: "パン屋" }).select("id").single();
  if (error) throw error;
  projects.push(data.id);
  await admin.from("project_social_accounts").insert([
    { project_id: data.id, social_account_id: threadsAccount, owner_id: aliceId },
    { project_id: data.id, social_account_id: xAccount, owner_id: aliceId },
  ]);
  return data.id as string;
}
const planArgs = (projectId: string, over: Record<string, unknown> = {}) => ({
  p_plan_id: null as unknown as string,
  p_project_id: projectId,
  p_name: "ネタ帳から",
  p_kind: "notes",
  p_materials: { note_order: "old_first" },
  p_targets: { threads: "auto", x: "review" },
  p_x_link: "never",
  p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "09:00", every_weeks: 1, start: "2026-11-01" },
  p_instructions: [] as string[],
  p_lead_hours: 24,
  p_consent: true,
  ...over,
});
async function plan(projectId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await alice.rpc("save_auto_plan", planArgs(projectId, over));
  if (error) throw error;
  return data as string;
}
const planOf = async (id: string) => toPlan((await admin.from("auto_plans").select("*").eq("id", id).single()).data!);
const note = async (projectId: string, body: string) => (await alice.from("idea_notes").insert({ project_id: projectId, body }).select("id").single()).data!.id as string;
// 保存する前の見本（ウィザード）: 回し方の id は仮のもの
const draftPlan = async (projectId: string, instructions: string[] = []) => ({ ...(await planOf(await plan(projectId, { p_instructions: instructions }))), id: NO_PLAN_ID });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  threadsAccount = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "threads", externalId: `th-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  xAccount = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "x", externalId: `x-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  setAiBudgetTestScope({ scopeSelf: true, asOf: new Date("2100-01-01T00:00:00Z") });
});

afterEach(async () => {
  findings = [];
  inputs.length = 0;
  await admin.from("ai_usage").delete().eq("owner_id", aliceId);
  await admin.from("projects").delete().in("id", projects.splice(0));
});

afterAll(async () => {
  setAiBudgetTestScope(null);
  await admin.from("ai_usage").delete().in("owner_id", [aliceId, bobId]);
  await deleteUser(aliceId);
  await deleteUser(bobId);
  for (const table of ["auto_plans", "auto_runs", "auto_samples", "ai_usage"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
});

describe("書き方の指示（auto_plans.instructions）", () => {
  it("保存できる。同じ指示は 1 つにし、前後の空白は除く", async () => {
    const id = await plan(await project(), { p_instructions: [" 絵文字なし ", "絵文字なし", "もっと短く"] });
    expect((await planOf(id)).instructions).toEqual(["絵文字なし", "もっと短く"]);
  });

  it("9 個・101 字・改行・文字でないものは断る", async () => {
    const p = await project();
    for (const bad of [Array.from({ length: 9 }, (_, i) => `指示 ${i}`), ["あ".repeat(101)], ["1 行目\n2 行目"], [1], [""], "絵文字なし"]) {
      const { error } = await alice.rpc("save_auto_plan", planArgs(p, { p_instructions: bad }));
      expect(error?.hint, JSON.stringify(bad)).toBe("auto_instructions_invalid");
    }
  });

  it("古い形（p_tone）でも保存でき、口調の指示は指示の 1 つになる（本番の db push から git push までの間）", async () => {
    const p = await project();
    const rest: Record<string, unknown> = { ...planArgs(p) };
    delete rest.p_instructions;
    const { data, error } = await alice.rpc("save_auto_plan", { ...rest, p_tone: " 季節の話から入る " } as never);
    expect(error).toBeNull();
    expect((await planOf(data as string)).instructions).toEqual(["季節の話から入る"]);
    const { data: empty } = await alice.rpc("save_auto_plan", { ...rest, p_tone: "" } as never);
    expect((await planOf(empty as string)).instructions).toEqual([]);
  });

  it("指示だけを直せる（set_auto_plan_instructions）。ほかの人の回し方は直せない。運営者が止めている間は断る", async () => {
    const id = await plan(await project());
    const { data, error } = await alice.rpc("set_auto_plan_instructions", { p_plan_id: id, p_instructions: ["やわらかく", "やわらかく"] });
    expect(error).toBeNull();
    expect(data).toEqual(["やわらかく"]);
    expect((await planOf(id)).instructions).toEqual(["やわらかく"]);
    expect((await bob.rpc("set_auto_plan_instructions", { p_plan_id: id, p_instructions: [] })).error?.code).toBe("P0002");
    expect((await alice.rpc("set_auto_plan_instructions", { p_plan_id: id, p_instructions: ["あ".repeat(101)] })).error?.hint).toBe("auto_instructions_invalid");
    await admin.from("auto_post_holds").insert({ user_id: aliceId, reason: "テスト", held_by: "test" });
    try {
      expect((await alice.rpc("set_auto_plan_instructions", { p_plan_id: id, p_instructions: [] })).error?.hint).toBe("auto_post_hold");
    } finally {
      await admin.from("auto_post_holds").delete().eq("user_id", aliceId);
    }
    expect((await planOf(id)).instructions).toEqual(["やわらかく"]);
  });

  it("毎回の AI に、回し方の指示と、見本のその 1 回だけの指示を渡す", async () => {
    const p = await project();
    await note(p, "新しいパン");
    const planRow = await draftPlan(p, ["絵文字なし"]);
    const r = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow, oneTime: ["もっと短く"] });
    expect(r.ok).toBe(true);
    expect(inputs.at(-1)?.instructions).toEqual(["絵文字なし", "もっと短く"]);
    expect(inputs.at(-1)?.purpose).toBe("auto_post_sample");
    // 見本は翌日に送る回として作る（AI に送る日と季節を渡す）
    expect(Math.abs(inputs.at(-1)!.dueAt.getTime() - (Date.now() + 86_400_000))).toBeLessThan(60_000);
  });
});

describe("見本（auto_samples）", () => {
  it("画面の利用者は読めない・書けない（サーバーだけ）", async () => {
    const p = await project();
    await note(p, "メモ");
    const r = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: await draftPlan(p) });
    expect(r.ok && r.sampleId).toBeTruthy();
    expect((await alice.from("auto_samples").select("id")).data ?? []).toEqual([]);
    expect((await bob.from("auto_samples").select("id")).data ?? []).toEqual([]);
    const { error } = await alice.from("auto_samples").insert({ owner_id: aliceId, project_id: p, settings: {}, material: {}, texts: {} });
    expect(error).not.toBeNull();
  });

  it("同じ材料で作り直す（前の見本の材料を使う）。ほかの人の見本の材料は使わない", async () => {
    const p = await project();
    await note(p, "一つ目のメモ");
    await note(p, "二つ目のメモ");
    const planRow = await draftPlan(p);
    const first = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow });
    expect(first.ok && first.label).toBe("メモ: 一つ目のメモ");
    // 材料を書き換えたことにして、前の見本の材料が使われるかを確かめる
    await admin.from("auto_samples").update({ material: { ...(await admin.from("auto_samples").select("material").eq("id", first.ok ? first.sampleId! : "").single()).data!.material as object, label: "メモ: 二つ目のメモ" } }).eq("id", first.ok ? first.sampleId! : "");
    const again = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow, fromSampleId: first.ok ? first.sampleId! : undefined });
    expect(again.ok && again.label).toBe("メモ: 二つ目のメモ");
    // bob の見本の id を渡しても、alice の見本としては使わない（選び直す）
    const other = await makeSample(admin, deps(), { ownerId: bobId, projectId: p, plan: planRow, fromSampleId: first.ok ? first.sampleId! : undefined });
    expect(other.ok).toBe(false);
  });

  it("見本（auto_post_sample）は 1 人 1 日 5 回まで。ジョブの回（auto_post）の 1 日 10 回とは別に数える", async () => {
    const reserve = async (purpose: string) =>
      (await admin.rpc("reserve_ai_usage", { p_owner_id: aliceId, p_purpose: purpose, p_cost_usd: 0.13, p_scope_owner: aliceId, p_as_of: "2100-01-01T00:00:00Z" })).data?.[0]?.status;
    for (let i = 0; i < 5; i++) expect(await reserve("auto_post_sample")).toBe("ok");
    expect(await reserve("auto_post_sample")).toBe("auto_sample_limit");
    expect(await reserve("auto_post")).toBe("ok");
  });

  it("1 日たった見本は消す", async () => {
    const p = await project();
    await note(p, "メモ");
    const r = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: await draftPlan(p) });
    const id = r.ok ? r.sampleId! : "";
    await purgeSamples(admin, new Date(Date.now() + 2 * 86_400_000), { ownerIds: [aliceId] });
    expect((await admin.from("auto_samples").select("id").eq("id", id)).data).toEqual([]);
  });
});

describe("この見本を最初の回にする（adoptSample）", () => {
  async function sampled(instructions: string[] = []) {
    const p = await project();
    const noteId = await note(p, "見本のメモ");
    const r = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: await draftPlan(p, instructions) });
    if (!r.ok || !r.sampleId) throw new Error("見本を作れませんでした");
    return { p, noteId, sampleId: r.sampleId, texts: r.texts };
  }

  it("最初の送る時刻の回を見本の文で作り、最初の確かめを済ませる。見本は 1 回だけ使える。メモは使ったことにする", async () => {
    const { p, noteId, sampleId, texts } = await sampled();
    const id = await plan(p);
    const r = await adoptSample(admin, { ownerId: aliceId, planId: id, sampleId });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, status: "scheduled" });
    const { data: runs } = await admin.from("auto_runs").select("status, post_id, due_at").eq("plan_id", id);
    expect(runs).toHaveLength(1);
    const { data: post } = await admin.from("posts").select("body, status, post_targets(sns, status)").eq("id", runs![0].post_id!).single();
    expect(post!.body).toBe(texts.threads);
    expect(Object.fromEntries(post!.post_targets.map((t) => [t.sns, t.status]))).toEqual({ threads: "pending", x: "awaiting_approval" });
    expect((await planOf(id)).firstReview).toBe(false);
    expect((await admin.from("idea_notes").select("used_at").eq("id", noteId).single()).data!.used_at).not.toBeNull();
    expect(await adoptSample(admin, { ownerId: aliceId, planId: id, sampleId })).toMatchObject({ ok: false });
  });

  it("見本を作ったあとに設定（指示）を変えたら、最初の回にしない", async () => {
    const { p, sampleId } = await sampled(["絵文字なし"]);
    const id = await plan(p, { p_instructions: ["やわらかく"] });
    const r = await adoptSample(admin, { ownerId: aliceId, planId: id, sampleId });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain("設定を変えた");
    expect((await admin.from("auto_runs").select("id").eq("plan_id", id)).data).toEqual([]);
    expect((await planOf(id)).firstReview).toBe(true);
  });

  it("確かめで引っかかった見本・ほかの人の見本は、最初の回にしない", async () => {
    findings = [{ sns: "x", kind: "made_up", quote: "の話", why: "本当ですか", fix: "" }];
    const held = await sampled();
    findings = [];
    const id = await plan(held.p);
    expect(await adoptSample(admin, { ownerId: aliceId, planId: id, sampleId: held.sampleId })).toMatchObject({ ok: false });
    const mine = await sampled();
    const bobPlan = await plan(mine.p);
    // bob として、alice の見本を使おうとする（回し方も alice のものなので、どちらにしても見つからない）
    expect(await adoptSample(admin, { ownerId: bobId, planId: bobPlan, sampleId: mine.sampleId })).toMatchObject({ ok: false });
    expect((await admin.from("auto_samples").select("id").eq("id", mine.sampleId)).data).toHaveLength(1);
  });
});
