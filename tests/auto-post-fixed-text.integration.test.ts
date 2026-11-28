// シリーズのフォーマットの毎回同じ文への確認の指摘は数えない（2026-11-28 通しの検証。本番と同じ連想映画クイズで、毎回「？と！が続く」の指摘が固定の文に出た）。
// 偽の確認の返事で、固定の文への強い指摘でも止めず、変数の言葉への指摘は今までどおり止めることを確かめる。偽の AI だけで通す。本物の AI・SNS は呼ばない
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { GenerateImage } from "@/lib/ai/gemini-image";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { makeDueRuns, type EngineDeps } from "@/lib/auto-post/engine";
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

const BODY = "連想映画クイズ🎬\n\nこの画像から連想される映画は？答えはコメントで！\n\n【{キーワード5つ}】";
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

afterEach(async () => {
  findings = [];
  vi.mocked(callCheck).mockClear();
  // 偽の AI の文は回ごとに同じなので、前のテストの投稿と「似ている」で止まらないように消す
  await admin.from("posts").delete().eq("owner_id", aliceId);
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

describe("固定の文への指摘", () => {
  it("確認の AI に固定の文を <fixed> で渡す", async () => {
    const run = await dueRun(await quizPlan());
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    expect((await runOf(run)).status).toBe("scheduled");
    const req = JSON.stringify(vi.mocked(callCheck).mock.calls.at(-1)![0]);
    expect(req).toContain("<fixed>");
    expect(req).toContain("この画像から連想される映画は？答えはコメントで！");
  });

  it("固定の文への強い指摘（事実か確かめて・確かな指摘）でも止めず、数だけ残す", async () => {
    findings = [
      { sns: "x", kind: "made_up", quote: "この画像から連想される映画は？答えはコメントで！", why: "本当ですか", fix: "", certain: true } as never,
      { sns: "threads", kind: "other", quote: "答えはコメントで！", why: "にぎやか", fix: "答えはコメントで。", certain: false } as never,
    ];
    const run = await dueRun(await quizPlan());
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    const r = (await admin.from("auto_runs").select("status, material_ref").eq("id", run).single()).data!;
    expect(r.status, JSON.stringify(r)).toBe("scheduled");
    expect((r.material_ref as { fixed_text_findings?: number }).fixed_text_findings).toBe(2);
  });

  it("変数の言葉への強い指摘は、今までどおり止める", async () => {
    findings = [{ sns: "threads", kind: "made_up", quote: "（偽の AI）キーワード5つ", why: "本当ですか", fix: "", certain: true } as never];
    const run = await dueRun(await quizPlan());
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    expect((await runOf(run)).status).toBe("held");
  });
});
