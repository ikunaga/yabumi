// 自動投稿と、フォーマットの「自分で入れる」変数（2026-11-21 オーナーの決定。docs/design/format-series.md の 1.2、20261121180000_format_variables）:
// 決め方（毎回同じ言葉・AI に考えてもらう）がないと保存できない・保存したときの作り方はサーバーが決める・
// フォーマットの変数が変わったら、その回は作らずに止めて知らせる（要確認）・「再開する」では動かさず、決め直して保存すると動く。
// 偽の AI（fakeSeries）で通し、本物の AI は呼ばない。回の取り出しはテストの利用者だけに絞る
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { makeDueRuns, type EngineDeps } from "@/lib/auto-post/engine";
import type { CallFormatRound } from "@/lib/ai/format-round-ai";
import { ROUND_FAILED_TEXT } from "@/lib/auto-post/series-round";
import { addFormat, updateFormat } from "@/lib/post-formats/store";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let aliceId: string;
let projectId: string;
const HOUR = 3_600_000;
const scopeOpts = () => ({ ownerIds: [aliceId] });

const generator: AutoPostGenerator = vi.fn(async () => ({ ok: false as const, reason: "error" as const, detail: "シリーズでは呼ばない" }));
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings: [] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 } }));
const push = vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 }));
const deps = (): EngineDeps => ({ generator, callCheck, push, fakeSeries: true });

const BODY = "連想映画クイズ🎬\n{キーワード}\nこの 5 つから連想する映画は？答えは{答え方}で";
const SERIES = {
  vars: [
    { name: "映画", mode: "ai", instruction: "だれでも知っている映画を 1 つ", unique: true },
    { name: "キーワード", mode: "ai", instruction: "{映画}を連想できる言葉を 5 つ", unique: false },
    { name: "答え方", mode: "hand", instruction: "", unique: false },
  ],
};

async function savePlan(formatId: string, materials: Record<string, unknown>, planId: string | null = null) {
  return alice.rpc("save_auto_plan", {
    p_plan_id: planId as unknown as string,
    p_project_id: projectId,
    p_name: "連想映画クイズ",
    p_kind: "series",
    p_materials: { format_id: formatId, ...materials },
    p_targets: { threads: "auto" },
    p_x_link: "never",
    p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "09:00", every_weeks: 1, start: "2026-11-01" },
    p_instructions: [],
    p_lead_hours: 24,
    p_consent: true,
  });
}

let day = 0;
async function dueRun(planId: string) {
  const { data, error } = await admin
    .from("auto_runs")
    .insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: new Date(Date.now() + (20 + 24 * day++) * HOUR).toISOString(), generate_at: new Date(Date.now() - 60_000).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
const planOf = async (id: string) => (await admin.from("auto_plans").select("status, stop_reason, materials").eq("id", id).single()).data!;
const runOf = async (id: string) => (await admin.from("auto_runs").select("status, reason, post_id").eq("id", id).single()).data!;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  projectId = (await alice.from("projects").insert({ name: "ねむり日和", product_type: "app" }).select("id").single()).data!.id;
  const account = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "threads", externalId: `th-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  await admin.from("project_social_accounts").insert({ project_id: projectId, social_account_id: account, owner_id: aliceId });
  setAiBudgetTestScope({ scopeSelf: true, asOf: new Date("2100-01-01T00:00:00Z") });
});

afterAll(async () => {
  await admin.from("ai_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
  expect((await admin.from("auto_plans").select("id", { count: "exact", head: true }).eq("owner_id", aliceId)).count).toBe(0);
});

describe("「自分で入れる」変数の決め方", () => {
  it("決め方がないと保存できない。決め方は「自分で入れる」変数だけ。作り方の控え（format_var_modes）は利用者から受け取らず、サーバーが決める", async () => {
    const formatId = await addFormat(alice, projectId, { name: "連想映画クイズ", body: BODY, series: SERIES });
    const none = await savePlan(formatId, {});
    expect(none.error?.hint).toBe("auto_format_vars_undecided");
    const extra = await savePlan(formatId, { format_vars: { 答え方: { value: "リプ" }, 映画: { value: "ずる" } } });
    expect(extra.error?.hint).toBe("auto_format_vars_undecided");
    for (const bad of [{ 答え方: { value: "" } }, { 答え方: { value: "a", instruction: "b" } }, { 答え方: { instruction: "あ".repeat(61) } }, { 答え方: "リプ" }]) {
      expect((await savePlan(formatId, { format_vars: bad })).error?.code, JSON.stringify(bad)).toBe("22023");
    }
    const ok = await savePlan(formatId, { format_vars: { 答え方: { value: "リプ" } }, format_var_modes: { 映画: "hand" } });
    expect(ok.error).toBeNull();
    expect((await planOf(ok.data!)).materials).toEqual({ format_id: formatId, format_vars: { 答え方: { value: "リプ" } }, format_var_modes: { 映画: "ai", キーワード: "ai", 答え方: "hand" } });
  });
});

describe("自動の回（偽の AI）", () => {
  it("毎回同じ言葉は本文に入り、AI の変数は偽の言葉で入る。どこにも出ない変数も記録に残す", async () => {
    const formatId = await addFormat(alice, projectId, { name: "連想映画クイズ 2", body: BODY, series: SERIES });
    const planId = (await savePlan(formatId, { format_vars: { 答え方: { value: "リプ" } } })).data!;
    await admin.from("auto_plans").update({ first_review: false }).eq("id", planId);
    const run = await dueRun(planId);
    expect(await makeDueRuns(admin, deps(), new Date(), scopeOpts())).toEqual({ scheduled: 1 });
    const r = await runOf(run);
    const text = JSON.stringify([(await admin.from("posts").select("body").eq("id", r.post_id!).single()).data, (await admin.from("post_targets").select("body_override").eq("post_id", r.post_id!)).data]);
    expect(text).toContain("答えはリプで");
    expect(text).toContain("（偽の AI）キーワード");
    const round = (await admin.from("post_format_rounds").select("values").eq("post_id", r.post_id!).single()).data!;
    expect(round.values).toMatchObject({ 映画: expect.stringContaining("（偽の AI）映画"), 答え方: "リプ" });
  });

  it("「AI に考えてもらう」を選んだ変数は、自動投稿では AI の変数として入る", async () => {
    const formatId = await addFormat(alice, projectId, { name: "連想映画クイズ 3", body: BODY, series: SERIES });
    const planId = (await savePlan(formatId, { format_vars: { 答え方: { instruction: "答え方を 1 つ" } } })).data!;
    await admin.from("auto_plans").update({ first_review: false }).eq("id", planId);
    const run = await dueRun(planId);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const round = (await admin.from("post_format_rounds").select("values").eq("post_id", (await runOf(run)).post_id!).single()).data!;
    expect(round.values).toMatchObject({ 答え方: expect.stringContaining("（偽の AI）答え方") });
  });
});

describe("本物の AI の返事が使えないとき（2026-11-28 本番で回が飛ばされた）", () => {
  const usage = { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 };
  const real = (call: CallFormatRound): EngineDeps => ({ generator, callCheck, push, callFormatRound: call });
  const good = { output: { proposals: [{ values: [{ name: "映画", text: "インセプション" }, { name: "キーワード", text: "夢・こま・階層・雪山・列車" }], checks: [] }] }, stopReason: "end_turn", model: "claude-opus-5-5", usage };

  it("1 回目が別のモデルに回って読めなくても、作り直して予約する", async () => {
    const formatId = await addFormat(alice, projectId, { name: "連想映画クイズ 5", body: BODY, series: SERIES });
    const planId = (await savePlan(formatId, { format_vars: { 答え方: { value: "リプ" } } })).data!;
    await admin.from("auto_plans").update({ first_review: false }).eq("id", planId);
    const run = await dueRun(planId);
    const call = vi.fn<CallFormatRound>().mockResolvedValueOnce({ ...good, output: null, model: "claude-sonnet-5-5", stopReason: "max_tokens" }).mockResolvedValueOnce(good);
    expect(await makeDueRuns(admin, real(call), new Date(), scopeOpts())).toEqual({ scheduled: 1 });
    expect(call).toHaveBeenCalledTimes(2);
    const round = (await admin.from("post_format_rounds").select("values").eq("post_id", (await runOf(run)).post_id!).single()).data!;
    expect(round.values).toMatchObject({ 映画: "インセプション" });
  });

  it("3 回とも駄目なら、飛ばさずに次のジョブでやり直す回にし、理由（回数・止まった理由・モデル）を残す", async () => {
    const formatId = await addFormat(alice, projectId, { name: "連想映画クイズ 6", body: BODY, series: SERIES });
    const planId = (await savePlan(formatId, { format_vars: { 答え方: { value: "リプ" } } })).data!;
    await admin.from("auto_plans").update({ first_review: false }).eq("id", planId);
    const run = await dueRun(planId);
    const call = vi.fn<CallFormatRound>(async () => ({ ...good, output: null, stopReason: "refusal" }));
    expect(await makeDueRuns(admin, real(call), new Date(), scopeOpts())).toEqual({ waiting: 1 });
    expect(call).toHaveBeenCalledTimes(3);
    const row = (await admin.from("auto_runs").select("status, reason_detail, post_id").eq("id", run).single()).data!;
    expect(row.status).toBe("waiting");
    expect(row.post_id).toBeNull();
    expect(row.reason_detail).toMatch(new RegExp(`^${ROUND_FAILED_TEXT}3 回: refusal opus-5-5 \\d+ 秒 / refusal`));
  });
});

describe("フォーマットの変数が変わったら、要確認で止める", () => {
  it("その回は作らずに取り消し、回し方を止めて知らせる。「再開する」では動かさず、決め直して保存すると動く", async () => {
    const formatId = await addFormat(alice, projectId, { name: "連想映画クイズ 4", body: BODY, series: SERIES });
    const planId = (await savePlan(formatId, { format_vars: { 答え方: { value: "リプ" } } })).data!;
    // 変数を足す（作り方の控えと合わなくなる）
    await updateFormat(alice, projectId, formatId, { name: "連想映画クイズ 4", body: `${BODY}\n{ひとこと}`, series: SERIES });
    const run = await dueRun(planId);
    push.mockClear();
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect(await runOf(run)).toMatchObject({ status: "canceled", reason: "plan_paused", post_id: null });
    expect(await planOf(planId)).toMatchObject({ status: "stopped", stop_reason: "format_changed" });
    expect(push).toHaveBeenCalledWith(expect.anything(), aliceId, expect.objectContaining({ body: expect.stringContaining("変数の決め方") }));
    const resume = await alice.rpc("set_auto_plan_status", { p_project_id: projectId, p_plan_id: planId, p_status: "active" });
    expect(resume.error?.hint).toBe("auto_plan_format_changed");
    // 止めても「要確認」のまま（止めてから再開して、決め直さずに動かせない）
    await alice.rpc("set_auto_plan_status", { p_project_id: projectId, p_plan_id: planId, p_status: "paused" });
    expect((await planOf(planId)).stop_reason).toBe("format_changed");
    // 決め直して保存すると動き出す。止めたときに取り消した、まだ来ていない回は作り直せるように消す
    expect((await savePlan(formatId, { format_vars: { 答え方: { value: "リプ" }, ひとこと: { value: "週末にどうぞ" } } }, planId)).error).toBeNull();
    expect(await planOf(planId)).toMatchObject({ status: "active", stop_reason: null });
    expect((await admin.from("auto_runs").select("id").eq("id", run)).data).toEqual([]);
  });

  it("変数の仕組みより前に保存した回し方（作り方の控えなし）は、決め方のない変数がなければそのまま動き、あれば止める", async () => {
    const formatId = await addFormat(alice, projectId, { name: "今日の一杯", body: "今日の一杯☕\n{豆}", series: { vars: [{ name: "豆", mode: "ai", instruction: "おすすめの豆", unique: false }] } });
    const planId = (await savePlan(formatId, {})).data!;
    await admin.from("auto_plans").update({ first_review: false, materials: { format_id: formatId } }).eq("id", planId);
    const run = await dueRun(planId);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect((await runOf(run)).status).toBe("scheduled");
    // 移したあとに「自分で入れる」変数ができたフォーマット（決め方がない）は、黙って送らずに止める
    await updateFormat(alice, projectId, formatId, { name: "今日の一杯", body: "今日の一杯☕\n{豆}\n{ひとこと}", series: { vars: [{ name: "豆", mode: "ai", instruction: "おすすめの豆", unique: false }] } });
    const run2 = await dueRun(planId);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    expect((await runOf(run2)).status).toBe("canceled");
    expect(await planOf(planId)).toMatchObject({ status: "stopped", stop_reason: "format_changed" });
  });
});

describe("フォーマットの飾りの【】（2026-11-23 本番の誤検知）", () => {
  it("フォーマットの文にもともとある【…】は書き加えるところとして止めず、予約する", async () => {
    const body = "連想映画クイズ🎬\n【{キーワード}】\nこの 5 つから連想する映画は？";
    const formatId = await addFormat(alice, projectId, { name: "【】のクイズ", body, series: { vars: [{ name: "キーワード", mode: "ai", instruction: "言葉を 5 つ", unique: false }] } });
    const planId = (await savePlan(formatId, {})).data!;
    await admin.from("auto_plans").update({ first_review: false }).eq("id", planId);
    const run = await dueRun(planId);
    await makeDueRuns(admin, deps(), new Date(), scopeOpts());
    const r = await runOf(run);
    expect(r).toMatchObject({ status: "scheduled", reason: null });
    const post = (await admin.from("posts").select("body").eq("id", r.post_id!).single()).data!;
    expect(post.body).toContain("【（偽の AI）キーワード");
  });
});
