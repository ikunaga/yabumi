// 見本（テストで 1 本つくる）の 1 日 5 回を、AI を呼ぶかどうかに関わらず 1 本ごとに数える（2026-11-21 のセキュリティ確認の M1。20261122110000_auto_sample_runs）。
// シリーズのフォーマット（文は型に入れるので文の AI を呼ばない）と、同じ材料での作り直し（AI はチェックだけ）の 6 回目を断る。
// 偽の AI・偽のチェックで、サーバーの権限で通す。本物の AI は呼ばない。最後にテストの行が 0 件になることを確かめる
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { limitMessage, setAiBudgetTestScope } from "@/lib/ai/budget";
import type { CallFormatRound } from "@/lib/ai/format-round-ai";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { makeSample, NO_PLAN_ID, purgeSamples, type EngineDeps } from "@/lib/auto-post/engine";
import { toPlan } from "@/lib/auto-post/plan-row";
import { AUTO_SAMPLE_DAILY_RUNS } from "@/lib/auto-post/schema";
import { addFormat } from "@/lib/post-formats/store";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let formatId: string;

const generator: AutoPostGenerator = vi.fn(async () => ({ ok: false as const, reason: "error" as const, detail: "シリーズでは呼ばない" }));
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings: [] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 } }));
// 偽の AI（AUTO_POST_FAKE_AI）のときと同じ: シリーズの変数は偽の言葉で埋める
const fakeDeps = (): EngineDeps => ({ generator, callCheck, fakeSeries: true });
const LIMIT = limitMessage("auto_sample_limit", null);

// 保存する前の見本（ウィザード）と同じ: 回し方の id は仮のもの。使い道はシリーズ
async function seriesPlan() {
  const { data, error } = await alice.rpc("save_auto_plan", {
    p_plan_id: null as unknown as string,
    p_project_id: projectId,
    p_name: "今日の一杯",
    p_kind: "notes",
    p_materials: { note_order: "old_first" },
    p_targets: { threads: "auto" },
    p_x_link: "never",
    p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "09:00", every_weeks: 1, start: "2026-11-01" },
    p_instructions: [] as string[],
    p_lead_hours: 24,
    p_consent: true,
  });
  if (error) throw error;
  const plan = toPlan((await admin.from("auto_plans").select("*").eq("id", data as string).single()).data!);
  return { ...plan, id: NO_PLAN_ID, kind: "series" as const, materials: { format_id: formatId } };
}
const sample = async (fromSampleId?: string, deps = fakeDeps()) => makeSample(admin, deps, { ownerId: aliceId, projectId, plan: await seriesPlan(), fromSampleId });
const runs = async () => (await admin.from("auto_sample_runs").select("id", { count: "exact", head: true }).eq("owner_id", aliceId)).count;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  const threadsAccount = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "threads", externalId: `th-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  projectId = (await alice.from("projects").insert({ name: "喫茶店" }).select("id").single()).data!.id;
  await admin.from("project_social_accounts").insert({ project_id: projectId, social_account_id: threadsAccount, owner_id: aliceId });
  formatId = await addFormat(alice, projectId, { name: "今日の一杯", body: "今日の一杯☕\n{豆}", series: { vars: [{ name: "豆", mode: "ai", instruction: "その日のおすすめの豆", unique: false }] } });
  setAiBudgetTestScope({ scopeSelf: true, asOf: new Date("2100-01-01T00:00:00Z") });
});

afterEach(async () => {
  vi.mocked(generator).mockClear();
  await admin.from("auto_sample_runs").delete().eq("owner_id", aliceId);
  await admin.from("auto_samples").delete().eq("owner_id", aliceId);
  await admin.from("ai_usage").delete().eq("owner_id", aliceId);
  await admin.from("auto_plans").delete().eq("owner_id", aliceId);
});

afterAll(async () => {
  setAiBudgetTestScope(null);
  await admin.from("ai_usage").delete().in("owner_id", [aliceId, bobId]);
  await deleteUser(aliceId);
  await deleteUser(bobId);
  for (const table of ["auto_sample_runs", "auto_samples", "auto_plans", "ai_usage"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
});

describe("見本の 1 日 5 回（auto_sample_runs）", () => {
  it("シリーズのフォーマット: 文の AI を呼ばなくても 1 本ごとに数え、6 回目は断る。本番の自動投稿（auto_post）の枠は使わない", async () => {
    for (let i = 0; i < AUTO_SAMPLE_DAILY_RUNS; i++) {
      const r = await sample();
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    }
    expect(await sample()).toEqual({ ok: false, reason: "ai_limit", detail: LIMIT });
    expect(await runs()).toBe(AUTO_SAMPLE_DAILY_RUNS);
    expect(generator).not.toHaveBeenCalled();
    // 断った 6 回目は、チェックの AI も呼ばない
    expect((await admin.from("ai_usage").select("purpose").eq("owner_id", aliceId)).data?.map((u) => u.purpose)).toEqual(Array(AUTO_SAMPLE_DAILY_RUNS).fill("auto_post_check"));
  });

  it("同じ材料で作り直す（シリーズ。AI はチェックだけ）も数え、6 回目は断る", async () => {
    const first = await sample();
    if (!first.ok || !first.sampleId) throw new Error("見本を作れませんでした");
    for (let i = 1; i < AUTO_SAMPLE_DAILY_RUNS; i++) {
      const r = await sample(first.sampleId);
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true, label: first.label });
    }
    expect(await sample(first.sampleId)).toEqual({ ok: false, reason: "ai_limit", detail: LIMIT });
    expect(await runs()).toBe(AUTO_SAMPLE_DAILY_RUNS);
  });

  it("シリーズの次の回の案の AI は、見本のときは auto_post_sample で予約する（本番の 1 日 10 回に数えない）", async () => {
    const call = vi.fn<CallFormatRound>(async () => ({
      output: { proposals: [{ values: [{ name: "豆", text: "エチオピア" }], checks: [] }] },
      stopReason: "end_turn",
      model: "claude-opus-5-5",
      usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 },
    }));
    const r = await sample(undefined, { generator, callCheck, callFormatRound: call });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, texts: { threads: "今日の一杯☕\nエチオピア" } });
    expect(call).toHaveBeenCalledTimes(1);
    const purposes = (await admin.from("ai_usage").select("purpose").eq("owner_id", aliceId)).data?.map((u) => u.purpose).sort();
    expect(purposes).toEqual(["auto_post_check", "auto_post_sample"]);
  });

  it("運営者が自動投稿を止めている人は、数えずに断る", async () => {
    // 回し方は止める前に作っておく（止めている間は保存もできない）
    const plan = await seriesPlan();
    await admin.from("auto_post_holds").insert({ user_id: aliceId, reason: "テスト", held_by: "test" });
    try {
      expect(await makeSample(admin, fakeDeps(), { ownerId: aliceId, projectId, plan })).toEqual({ ok: false, reason: "ai_limit", detail: limitMessage("auto_post_hold", null) });
    } finally {
      await admin.from("auto_post_holds").delete().eq("user_id", aliceId);
    }
    expect(await runs()).toBe(0);
  });

  it("本人・ほかの人・未ログインは、記録を読めず書けない。数える関数も呼べない（サーバーだけ）", async () => {
    expect((await sample()).ok).toBe(true);
    for (const [who, c] of [["本人", alice], ["ほかの人", bob], ["未ログイン", anonClient()]] as const) {
      const read = await c.from("auto_sample_runs").select("id");
      expect(read.error !== null || (read.data ?? []).length === 0, `${who} の select`).toBe(true);
      expect((await c.from("auto_sample_runs").insert({ owner_id: aliceId })).error, `${who} の insert`).not.toBeNull();
      await c.from("auto_sample_runs").update({ created_at: "2000-01-01T00:00:00Z" }).eq("owner_id", aliceId);
      await c.from("auto_sample_runs").delete().eq("owner_id", aliceId);
      expect((await c.rpc("reserve_auto_sample", { p_owner_id: aliceId })).error, `${who} の rpc`).not.toBeNull();
    }
    // update・delete は通らず、行は 1 件のまま・日時も変わらない
    const { data } = await admin.from("auto_sample_runs").select("created_at").eq("owner_id", aliceId);
    expect(data).toHaveLength(1);
    expect(new Date(data![0].created_at).getFullYear()).toBeGreaterThan(2000);
  });

  it("2 日たった記録は、見本の片付けで消す", async () => {
    expect((await sample()).ok).toBe(true);
    await purgeSamples(admin, new Date(Date.now() + 3 * 86_400_000), { ownerIds: [aliceId] });
    expect(await runs()).toBe(0);
  });
});
