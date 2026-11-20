// 自動の回の画像に見出しを重ねる（docs/design/auto-sample-image.md の 11.、20261120100000_auto_image_look。段取り ④）。偽の AI・偽の画像で、サーバーの権限で通す。
// 見た目の形（DB）・AI が書いた見出しを重ねて添える道（元の画像を残す・印・画像の説明）・見本の画像。最後にテストの行とファイルが 0 になることを確かめる
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { GenerateImage } from "@/lib/ai/gemini-image";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { adoptSample, makeDueRuns, makeSample, makeSampleImage, NO_PLAN_ID, type EngineDeps } from "@/lib/auto-post/engine";
import { toPlan } from "@/lib/auto-post/plan-row";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { createCanvas } from "@napi-rs/canvas";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let aliceId: string;
let bobId: string;
let threadsAccount: string;
let igAccount: string;

const HOUR = 3_600_000;
const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const AS_OF = "2100-01-01T00:00:00Z";

let n = 0;
const generator: AutoPostGenerator = vi.fn(async (input) => ({
  ok: true as const,
  texts: Object.fromEntries(input.sns.map((s: string) => [s, `焙煎の話 ${++n}`])),
  pillar: "",
  concern: "none",
  ...(input.headline ? { headline: "今朝の焙煎☕️ エチオピア🇪🇹" } : {}),
}));
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings: [] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 } }));
// 偽の画像の AI が返す JPEG（灰色の 800×1000）
let JPEG = new Uint8Array();
const prompts: string[] = [];
let imageFails = false;
const generate: GenerateImage = vi.fn(async ({ prompt }) => {
  prompts.push(prompt);
  if (imageFails) throw new Error("偽の画像の AI の失敗");
  return { bytes: JPEG, mimeType: "image/jpeg", inputTokens: 100 };
});
const callScene = vi.fn(async () => ({
  output: { ideas: [{ title: "朝の店先", scene: "木の机の上に、焙煎したコーヒー豆が広がっている", why: "" }] },
  stopReason: "end_turn" as const,
  model: "claude-opus-5-5",
  usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 },
}));
const deps = (): EngineDeps => ({ generator, callCheck, image: { generate, model: "gemini-nano-banana-2.1", callScene, scopeOwner: aliceId, asOf: new Date(AS_OF) } });

const projects: string[] = [];
async function project() {
  const { data, error } = await alice.from("projects").insert({ name: "パン屋", product_type: "shop" }).select("id").single();
  if (error) throw error;
  projects.push(data.id);
  await admin.from("project_social_accounts").insert([
    { project_id: data.id, social_account_id: threadsAccount, owner_id: aliceId },
    { project_id: data.id, social_account_id: igAccount, owner_id: aliceId },
  ]);
  return data.id as string;
}
const LOOK = { palette: "kinari", brand: "#e4572e", font: "gothic", textStyle: "band" };
const IMAGE: Record<string, unknown> = { source: "ai", style: "illustration", size: "auto", headline: "ai", look: LOOK };
const planArgs = (projectId: string, over: Record<string, unknown> = {}) => ({
  p_plan_id: null as unknown as string,
  p_project_id: projectId,
  p_name: "ネタ帳から",
  p_kind: "notes",
  p_materials: { note_order: "old_first" },
  p_targets: { threads: "auto", instagram: "auto" },
  p_x_link: "never",
  p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "09:00", every_weeks: 1, start: "2026-11-01" },
  p_instructions: [] as string[],
  p_image: IMAGE as never,
  p_lead_hours: 24,
  p_consent: true,
  ...over,
});
async function plan(projectId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await alice.rpc("save_auto_plan", planArgs(projectId, over));
  if (error) throw error;
  return data as string;
}
const planOf = async (id: string) => ({ ...toPlan((await admin.from("auto_plans").select("*").eq("id", id).single()).data!), ownerId: aliceId });
const note = async (projectId: string, body: string) => (await alice.from("idea_notes").insert({ project_id: projectId, body }).select("id").single()).data!.id as string;
let day = 0;
async function dueRun(planId: string, projectId: string) {
  const { data, error } = await admin
    .from("auto_runs")
    .insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: later(20 + 24 * day++), generate_at: new Date(Date.now() - 60_000).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
async function removeFiles(owner: string) {
  for (const dir of [`${owner}/gen`, owner]) {
    const { data } = await admin.storage.from("post-media").list(dir, { limit: 1000 });
    const files = (data ?? []).filter((o) => o.id).map((o) => `${dir}/${o.name}`);
    if (files.length) await admin.storage.from("post-media").remove(files);
  }
}

beforeAll(async () => {
  const c = createCanvas(800, 1000);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#777777";
  ctx.fillRect(0, 0, 800, 1000);
  JPEG = new Uint8Array(await c.encode("jpeg", 90));
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  threadsAccount = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "threads", externalId: `th-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  igAccount = await saveConnectedAccount(admin, { ownerId: aliceId, sns: "instagram", externalId: `ig-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date("2099-01-01"), scopes: [] }, key);
  setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(AS_OF) });
});

afterEach(async () => {
  imageFails = false;
  prompts.length = 0;
  vi.mocked(generate).mockClear();
  await admin.from("ai_usage").delete().in("owner_id", [aliceId, bobId]);
  await admin.from("ai_image_jobs").delete().in("owner_id", [aliceId, bobId]);
  await admin.from("ai_image_notices").delete().eq("owner_id", aliceId);
  await admin.from("projects").delete().in("id", projects.splice(0));
  await removeFiles(aliceId);
});

afterAll(async () => {
  setAiBudgetTestScope(null);
  await removeFiles(aliceId);
  await deleteUser(aliceId);
  await deleteUser(bobId);
  for (const table of ["auto_plans", "auto_runs", "auto_samples", "ai_usage", "ai_image_jobs", "media_files"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
  expect(((await admin.storage.from("post-media").list(`${aliceId}/gen`)).data ?? []).filter((o) => o.id)).toEqual([]);
});

const notice = () => admin.from("ai_image_notices").insert({ owner_id: aliceId });
const text = async (path: string) => Buffer.from(await (await admin.storage.from("post-media").download(path)).data!.arrayBuffer()).toString("latin1");

describe("見出しの見た目（auto_image_valid の look）", () => {
  it("見出しを重ねるときだけ持てる。決まった値だけ", async () => {
    await notice();
    const p = await project();
    expect((await alice.rpc("save_auto_plan", planArgs(p))).error).toBeNull();
    for (const bad of [
      { ...IMAGE, headline: "none" },
      { ...IMAGE, look: { ...LOOK, palette: "rainbow" } },
      { ...IMAGE, look: { ...LOOK, brand: "red" } },
      { ...IMAGE, look: { ...LOOK, font: "comic" } },
      { ...IMAGE, look: { ...LOOK, extra: 1 } },
      { ...IMAGE, look: { palette: "ai" } },
    ]) {
      expect((await alice.rpc("save_auto_plan", planArgs(p, { p_image: bad }))).error?.hint, JSON.stringify(bad)).toBe("auto_image_invalid");
    }
    // 見た目なしでも、見出しを重ねられる（既定の見た目で描く）。③ の形（look なし）もそのまま
    const { look: _l, ...noLook } = IMAGE;
    void _l;
    expect((await alice.rpc("save_auto_plan", planArgs(p, { p_image: noLook }))).error).toBeNull();
    expect((await alice.rpc("save_auto_plan", planArgs(p, { p_image: { ...noLook, headline: "none" } }))).error).toBeNull();
  });
});

describe("見出しを重ねて添える", () => {
  it("AI が書いた見出し（絵文字を取り除いたもの）を重ね、重ねる前の写真を元の画像として残す", async () => {
    await notice();
    const p = await project();
    await note(p, "新しい豆");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const runId = await dueRun(id, p);
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    const { data: run } = await admin.from("auto_runs").select("status, post_id").eq("id", runId).single();
    expect(run!.status).toBe("scheduled");
    // AI に見出しを頼んだ
    expect(vi.mocked(generator).mock.calls.at(-1)?.[0].headline).toBe(true);
    const { data: attached } = await admin.from("media_files").select("*").eq("post_id", run!.post_id!);
    expect(attached).toHaveLength(1);
    const f = attached![0];
    expect(f).toMatchObject({ ai_generated: true, has_text: true, alt_text: "見出し「今朝の焙煎 エチオピア」。木の机の上に、焙煎したコーヒー豆が広がっている" });
    expect(f.edit).toMatchObject({ kind: "headline", headline: { headline: "今朝の焙煎 エチオピア", palette: "kinari", font: "gothic", textStyle: "band" } });
    expect(f.original_id).toBe(f.edit_base_id);
    const { data: base } = await admin.from("media_files").select("*").eq("id", f.original_id!).single();
    expect(base).toMatchObject({ post_id: null, source_of: f.id, ai_generated: true });
    // 印: 重ねたものは composite、元の写真は generated
    expect(await text(f.storage_path)).toContain("compositeWithTrainedAlgorithmicMedia");
    expect(await text(base!.storage_path)).toContain("digitalsourcetype/trainedAlgorithmicMedia");
    // 重ねた画像は写真と同じ縦横（写真に近い大きさに並べる）
    expect(f.width / f.height).toBeCloseTo(4 / 5, 1);
  });

  it("見出しを重ねない設定なら、③ と同じく写真だけを添える", async () => {
    await notice();
    const p = await project();
    await note(p, "メモ");
    const { look: _l, ...noLook } = IMAGE;
    void _l;
    const id = await plan(p, { p_image: { ...noLook, headline: "none" } });
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const runId = await dueRun(id, p);
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    const { data: run } = await admin.from("auto_runs").select("post_id").eq("id", runId).single();
    const { data: attached } = await admin.from("media_files").select("has_text, original_id, edit").eq("post_id", run!.post_id!);
    expect(attached).toEqual([{ has_text: null, original_id: null, edit: null }]);
    expect(vi.mocked(generator).mock.calls.at(-1)?.[0].headline).toBe(false);
  });
});

describe("見本の画像にも見出しを重ね、最初の回にする", () => {
  it("見本でつくった見出しつきの画像を、元の画像ごと最初の回に添える", async () => {
    await notice();
    const p = await project();
    await note(p, "見本のメモ");
    const planRow = { ...(await planOf(await plan(p))), id: NO_PLAN_ID };
    const s = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow });
    if (!s.ok || !s.sampleId) throw new Error("見本を作れませんでした");
    const img = await makeSampleImage(admin, deps(), { ownerId: aliceId, projectId: p, sampleId: s.sampleId });
    expect(img.ok && img.image.alt).toContain("見出し「今朝の焙煎 エチオピア」");
    const id = await plan(p);
    const r = await adoptSample(admin, { ownerId: aliceId, planId: id, sampleId: s.sampleId });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, status: "scheduled" });
    const { data: run } = await admin.from("auto_runs").select("post_id").eq("plan_id", id).single();
    const { data: attached } = await admin.from("media_files").select("id, has_text, original_id").eq("post_id", run!.post_id!);
    expect(attached).toHaveLength(1);
    expect(attached![0].has_text).toBe(true);
    expect((await admin.from("media_files").select("source_of").eq("id", attached![0].original_id!).single()).data!.source_of).toBe(attached![0].id);
  });
});
