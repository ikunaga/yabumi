// 本番 2026-11-24 の「飛ばした・うまく作れませんでした」（auto_runs.reason = error）の再現と、直し（理由を残す・やり直す・知らせる）。
// 回し方は本番と同じ形: シリーズ（{映画} は AI が考え投稿に出ない、本文に【{キーワード5つ}】）、フォーマットの画像あり、X は確認して送る・Threads・Instagram。
// 偽の AI（fakeSeries・偽の画像・偽の場面・偽のチェック）で通す。本物の AI・SNS は呼ばない
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { GenerateImage } from "@/lib/ai/gemini-image";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { errorDetail, makeDueRuns, RUN_ATTEMPTS_MAX, settleStaleReservations, TIMEOUT_DETAIL, type EngineDeps } from "@/lib/auto-post/engine";
import { collectAutoNotices } from "@/lib/auto-post/mail";
import { addFormat } from "@/lib/post-formats/store";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let aliceId: string;
let projectId: string;
const HOUR = 3_600_000;
const AS_OF = "2100-01-01T00:00:00Z";

const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64"));
const generate: GenerateImage = vi.fn(async () => ({ bytes: JPEG, mimeType: "image/jpeg", inputTokens: 100 }));
const callScene = vi.fn(async () => ({
  output: { ideas: [{ title: "机", scene: "古い映画のチケットが机に並んでいる", why: "" }] },
  stopReason: "end_turn" as const,
  model: "claude-opus-5-5",
  usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 },
}));
const generator: AutoPostGenerator = vi.fn(async () => ({ ok: false as const, reason: "error" as const, detail: "シリーズでは呼ばない" }));
let findings: { sns: string; kind: string; quote: string; why: string; fix: string }[] = [];
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 } }));
const push = vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 }));
const deps = (): EngineDeps => ({ generator, callCheck, push, fakeSeries: true, image: { generate, model: "gemini-nano-banana-2.1", callScene, scopeOwner: aliceId, asOf: new Date(AS_OF) } });

const BODY = "この画像から連想される映画は？\n【{キーワード5つ}】";
const SERIES = {
  vars: [
    { name: "映画", mode: "ai", instruction: "だれでも知っている映画を 1 つ", unique: true },
    { name: "キーワード5つ", mode: "ai", instruction: "{映画}を連想できる言葉を 5 つ。「・」でつなぐ", unique: false },
  ],
};
const FORMAT_IMAGE = { prompt: "{キーワード5つ}を思わせる小物が並ぶ机", scene: "ai", style: "photo", size: "auto", headline: "この画像から連想される映画は？" };

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
const runOf = async (id: string) => (await admin.from("auto_runs").select("status, reason, reason_detail, post_id, attempts").eq("id", id).single()).data!;

async function quizPlan() {
  const formatId = await addFormat(alice, projectId, { name: `連想映画クイズ ${randomUUID().slice(0, 4)}`, body: BODY, series: SERIES, image: FORMAT_IMAGE });
  const { data, error } = await alice.rpc("save_auto_plan", {
    p_plan_id: null as unknown as string,
    p_project_id: projectId,
    p_name: "連想映画クイズ",
    p_kind: "series",
    p_materials: { format_id: formatId },
    p_targets: { x: "review", threads: "auto", instagram: "auto" },
    p_x_link: "never",
    p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "21:00", every_weeks: 1, start: "2026-11-01" },
    p_instructions: [],
    p_lead_hours: 24,
    p_consent: true,
    p_image: { source: "format", style: "photo", size: "auto", headline: "format" },
  });
  if (error) throw error;
  await admin.from("auto_plans").update({ first_review: false }).eq("id", data);
  return data as string;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  await admin.from("ai_image_notices").insert({ owner_id: aliceId });
  projectId = (await alice.from("projects").insert({ name: "映画好き", product_type: "creator" }).select("id").single()).data!.id;
  for (const sns of ["x", "threads", "instagram"] as const) {
    const account = await saveConnectedAccount(admin, { ownerId: aliceId, sns, externalId: `${sns}-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
    await admin.from("project_social_accounts").insert({ project_id: projectId, social_account_id: account, owner_id: aliceId });
  }
  setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(AS_OF) });
});

afterEach(() => {
  findings = [];
});

afterAll(async () => {
  setAiBudgetTestScope(null);
  await admin.from("ai_usage").delete().eq("owner_id", aliceId);
  await admin.from("ai_image_jobs").delete().eq("owner_id", aliceId);
  for (const dir of [`${aliceId}/gen`, aliceId]) {
    const { data } = await admin.storage.from("post-media").list(dir, { limit: 1000 });
    const files = (data ?? []).filter((f) => f.id).map((f) => `${dir}/${f.name}`);
    if (files.length) await admin.storage.from("post-media").remove(files);
  }
  await deleteUser(aliceId);
});

describe("本番と同じ形の回し方（再現）", () => {
  it("ふつうに作れる回は予約になる", async () => {
    const run = await dueRun(await quizPlan());
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    const r = await runOf(run);
    expect(r, JSON.stringify(r)).toMatchObject({ status: "scheduled" });
  });

  it("確認で止まる回（held）も、画像を付けて下書きに回る", async () => {
    findings = [{ sns: "threads", kind: "made_up", quote: "映画", why: "確かめて", fix: "" }];
    const run = await dueRun(await quizPlan());
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    const r = await runOf(run);
    // 理由は確認か「似ている」（偽の AI の言葉は回ごとの番号しか変わらないため）。どちらでも、例外にならずに下書きに回る
    expect(r, JSON.stringify(r)).toMatchObject({ status: "held" });
  });
});

// ===== 直し（2026-11-24）: 理由を残す・送る時刻の前ならやり直す・3 回で駄目なら飛ばして知らせる・打ち切られた回を理由つきで片付ける =====

describe("理由の文（errorDetail）", () => {
  it("種類と文の頭だけ。鍵・メールアドレス・URL・長い英数字は伏せ、200 字まで", () => {
    const e = Object.assign(new Error("boom sk-ant-abcdefghijklmnop at https://api.example.com/x for a@b.jp " + "あ".repeat(300)), { code: "23514" });
    const d = errorDetail(e);
    expect(d).toContain("code 23514");
    expect(d).not.toMatch(/sk-ant|https:|a@b\.jp/);
    expect([...d].length).toBeLessThanOrEqual(200);
    expect(errorDetail("文字だけ")).toBe("例外: 文字だけ");
  });
});

describe("回を作れなかったとき", () => {
  const operatorFetch = vi.fn(async () => new Response("{}", { status: 200 }));
  const failing = (): EngineDeps => ({
    ...deps(),
    fakeSeries: false,
    generator: vi.fn(async () => {
      throw new Error("偽の AI が落ちた");
    }),
    operator: { fetch: operatorFetch as unknown as typeof fetch, apiKey: "test", to: "ops@example.test" },
  });
  async function notesPlan() {
    await alice.from("idea_notes").insert({ project_id: projectId, body: "メモ" });
    const { data, error } = await alice.rpc("save_auto_plan", {
      p_plan_id: null as unknown as string,
      p_project_id: projectId,
      p_name: "ネタ帳から",
      p_kind: "notes",
      p_materials: { note_order: "old_first" },
      p_targets: { threads: "auto" },
      p_x_link: "never",
      p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "21:00", every_weeks: 1, start: "2026-11-01" },
      p_instructions: [],
      p_lead_hours: 24,
      p_consent: true,
    });
    if (error) throw error;
    await admin.from("auto_plans").update({ first_review: false }).eq("id", data);
    return data as string;
  }

  it(`送る時刻の前なら次のジョブでやり直し（理由は残す）、${RUN_ATTEMPTS_MAX} 回目で駄目なら飛ばして理由を残し、利用者と運営者に知らせる`, async () => {
    const run = await dueRun(await notesPlan());
    push.mockClear();
    for (let i = 1; i < RUN_ATTEMPTS_MAX; i++) {
      await makeDueRuns(admin, failing(), new Date(), { ownerIds: [aliceId] });
      // 同じジョブの中ですぐ取り直さない（作る時刻を 5 分あとにする）。次のジョブのつもりで、作る時刻を過ぎたことにする
      expect(await runOf(run)).toMatchObject({ status: "waiting", attempts: i, reason_detail: "例外: 偽の AI が落ちた" });
      await admin.from("auto_runs").update({ generate_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", run);
    }
    await makeDueRuns(admin, failing(), new Date(), { ownerIds: [aliceId] });
    expect(await runOf(run)).toMatchObject({ status: "skipped", reason: "error", reason_detail: "例外: 偽の AI が落ちた", attempts: RUN_ATTEMPTS_MAX });
    expect(push).toHaveBeenCalledWith(expect.anything(), aliceId, expect.objectContaining({ title: "自動投稿を 1 本、送れませんでした", body: expect.stringContaining("作れなかったので送りません") }));
    expect(operatorFetch).toHaveBeenCalled();
    // メールのまとめにも入る（作れなかった回）
    const notices = await collectAutoNotices(admin, new Date(), { ownerIds: [aliceId] });
    expect(notices.some((n) => n.kind === "auto_failed" && n.runId === run)).toBe(true);
  });

  it("作っている途中で打ち切られたまま 3 回取られた回は、ジョブが理由（時間内に作り終えられなかった）を残して飛ばし、知らせる", async () => {
    const planId = await quizPlan();
    const run = await dueRun(planId);
    await admin.from("auto_runs").update({ status: "generating", locked_at: new Date(Date.now() - 11 * 60_000).toISOString(), attempts: RUN_ATTEMPTS_MAX }).eq("id", run);
    push.mockClear();
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId], limit: 0 });
    expect(await runOf(run)).toMatchObject({ status: "skipped", reason: "error", reason_detail: TIMEOUT_DETAIL });
    expect(push).toHaveBeenCalledWith(expect.anything(), aliceId, expect.objectContaining({ title: "自動投稿を 1 本、送れませんでした", body: expect.stringContaining("作れなかったので送りません") }));
  });

  it("打ち切られた前の試みで途中まで作った投稿は、取り直したときに消してから作る（同じ回の投稿を 2 つ作らない）", async () => {
    const planId = await quizPlan();
    const run = await dueRun(planId);
    await admin.from("auto_runs").update({ status: "generating", locked_at: new Date(Date.now() - 11 * 60_000).toISOString(), attempts: 1 }).eq("id", run);
    const leftover = (await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "途中", status: "draft", auto_run_id: run }).select("id").single()).data!.id;
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    const r = await runOf(run);
    // 作り終える（予約か、偽の AI の言葉が前と似ていて下書き。どちらでも作れている）
    expect(["scheduled", "held"]).toContain(r.status);
    expect((await admin.from("posts").select("id").eq("id", leftover)).data).toEqual([]);
    expect((await admin.from("posts").select("id").eq("auto_run_id", run)).data).toHaveLength(1);
  });

  it("時間の見張り（deadline）をこえていたら、新しい回は取らない", async () => {
    const run = await dueRun(await quizPlan());
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId], deadline: Date.now() - 1 });
    expect((await runOf(run)).status).toBe("waiting");
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
  });
});

describe("精算されなかった AI の予約（関数が打ち切られた分）", () => {
  it("30 分たった予約は、見込みの額のまま「使った」にして、予約のままにしない。新しい予約は触らない", async () => {
    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    const t1 = (await admin.from("ai_usage").insert({ owner_id: aliceId, purpose: "auto_post", model: "reserved", cost_usd: 0.05, status: "reserved", created_at: old }).select("id").single()).data!.id;
    const t2 = (await admin.from("ai_usage").insert({ owner_id: aliceId, purpose: "auto_post", model: "reserved", cost_usd: 0.05, status: "reserved" }).select("id").single()).data!.id;
    const i1 = (await admin.from("ai_image_jobs").insert({ owner_id: aliceId, model: "gemini-nano-banana-2.1", images: 1, cost_usd: 0.04, status: "reserved", auto: true, created_at: old }).select("id").single()).data!.id;
    expect(await settleStaleReservations(admin, new Date(), [aliceId])).toEqual({ text: 1, images: 1 });
    expect((await admin.from("ai_usage").select("status, model, cost_usd").eq("id", t1).single()).data).toMatchObject({ status: "done", model: "abandoned", cost_usd: 0.05 });
    expect((await admin.from("ai_usage").select("status").eq("id", t2).single()).data!.status).toBe("reserved");
    expect((await admin.from("ai_image_jobs").select("status, model").eq("id", i1).single()).data).toMatchObject({ status: "done", model: "abandoned" });
    await admin.from("ai_usage").delete().in("id", [t1, t2]);
    await admin.from("ai_image_jobs").delete().eq("id", i1);
  });
});

