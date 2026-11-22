// 自動の回の画像（docs/design/auto-sample-image.md の 2.〜5.、20261119110000_auto_post_images）。偽の AI・偽の画像で、サーバーの権限で通す。
// 画像の AI の枠（手でつくる分と自動の分）・古い呼び方の互換・回に画像を添える道・画像をつくれなかった回・見本の画像。最後にテストの行とファイルが 0 になることを確かめる
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import { setAiBudgetTestScope } from "@/lib/ai/budget";
import type { GenerateImage } from "@/lib/ai/gemini-image";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { adoptSample, makeDueRuns, makeSample, makeSampleImage, NO_PLAN_ID, reviewPlans, type EngineDeps } from "@/lib/auto-post/engine";
import { toPlan } from "@/lib/auto-post/plan-row";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

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
const generator: AutoPostGenerator = vi.fn(async (input) => ({ ok: true as const, texts: Object.fromEntries(input.sns.map((s: string) => [s, `焙煎の話 ${++n}`])), pillar: "", concern: "none" }));
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings: [] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 } }));
// 1×1 の JPEG（偽の画像の AI）
const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64"));
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
const IMAGE = { source: "ai", style: "illustration", size: "auto", headline: "none" };
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
  p_image: IMAGE as Record<string, string>,
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
const reserveImages = (owner: string, images: number, extra: Record<string, unknown> = {}) =>
  admin.rpc("reserve_ai_images", { p_owner_id: owner, p_project_id: null as unknown as string, p_model: "gemini-nano-banana-2.1", p_images: images, p_cost_usd: 0.04 * images, p_scope_owner: owner, p_as_of: AS_OF, ...extra });

async function removeFiles(owner: string) {
  for (const dir of [`${owner}/gen`, owner]) {
    const { data } = await admin.storage.from("post-media").list(dir, { limit: 1000 });
    const files = (data ?? []).filter((o) => o.id).map((o) => `${dir}/${o.name}`);
    if (files.length) await admin.storage.from("post-media").remove(files);
  }
}

beforeAll(async () => {
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

describe("画像の設定（auto_image_valid・save_auto_plan）", () => {
  it("AI の画像の注意を読んでいないと、画像を選んだ回し方は保存できない", async () => {
    const p = await project();
    expect((await alice.rpc("save_auto_plan", planArgs(p))).error?.hint).toBe("ai_image_notice_missing");
    await notice();
    expect((await alice.rpc("save_auto_plan", planArgs(p))).error).toBeNull();
    // 画像なしなら、注意を読んでいなくても保存できる
    await admin.from("ai_image_notices").delete().eq("owner_id", aliceId);
    expect((await alice.rpc("save_auto_plan", planArgs(p, { p_image: {} }))).error).toBeNull();
  });

  it("フォーマットの画像はシリーズだけ・商品の紹介はイラストだけ・ほかのキーや値は断る", async () => {
    await notice();
    const p = await project();
    for (const bad of [
      { ...IMAGE, source: "format" },
      { ...IMAGE, size: "huge" },
      { ...IMAGE, prompt: "画面から送った絵の説明" },
      { ...IMAGE, headline: "format" },
      { source: "ai" },
    ]) {
      expect((await alice.rpc("save_auto_plan", planArgs(p, { p_image: bad }))).error?.hint, JSON.stringify(bad)).toBe("auto_image_invalid");
    }
    const { data: dest } = await admin.from("project_destinations").insert({ project_id: p, owner_id: aliceId, kind: "site", label: "店", url: "https://example.com/" }).select("id").single();
    const product = { p_kind: "product", p_materials: { destination_ids: [dest!.id] } };
    expect((await alice.rpc("save_auto_plan", planArgs(p, { ...product, p_image: { ...IMAGE, style: "photo" } }))).error?.hint).toBe("auto_image_invalid");
    expect((await alice.rpc("save_auto_plan", planArgs(p, product))).error).toBeNull();
  });

  it("古い呼び方（p_image を渡さない）でも保存でき、画像なしになる。p_tone の形は消した（L10）", async () => {
    const p = await project();
    const rest: Record<string, unknown> = { ...planArgs(p) };
    delete rest.p_image;
    const { data: a, error: e1 } = await alice.rpc("save_auto_plan", rest as never);
    expect(e1).toBeNull();
    expect((await planOf(a as string)).image).toBeNull();
    delete rest.p_instructions;
    const { error: e2 } = await alice.rpc("save_auto_plan", { ...rest, p_tone: "やわらかく" } as never);
    expect(e2?.code).toBe("PGRST202");
  });
});

describe("AI の画像の枠（手でつくる分と自動の分を別に数える）", () => {
  it("運営者が止めている人には、自動の分の画像を予約させない。手でつくる分は止めない（L7）", async () => {
    const { error } = await admin.from("auto_post_holds").insert({ user_id: aliceId, reason: "テスト", held_by: "test@example.com" });
    if (error) throw error;
    try {
      expect((await reserveImages(aliceId, 1, { p_auto: true })).data?.[0]).toMatchObject({ status: "auto_post_hold", job_id: null });
      const { count } = await admin.from("ai_image_jobs").select("*", { count: "exact", head: true }).eq("owner_id", aliceId).eq("auto", true);
      expect(count).toBe(0);
      expect((await reserveImages(aliceId, 1)).data?.[0]?.status).toBe("ok");
    } finally {
      await admin.from("auto_post_holds").delete().eq("user_id", aliceId);
      await admin.from("ai_image_jobs").delete().eq("owner_id", aliceId);
    }
  });

  it("自動の分は 1 人 月 31 枚。手でつくる分（20 枚）とは別に数える", async () => {
    for (let i = 0; i < 7; i++) expect((await reserveImages(aliceId, 4, { p_auto: true })).data?.[0]?.status).toBe("ok");
    expect((await reserveImages(aliceId, 3, { p_auto: true })).data?.[0]?.status).toBe("ok");
    expect((await reserveImages(aliceId, 1, { p_auto: true })).data?.[0]?.status).toBe("user_limit");
    // 手でつくる分は、まだ使っていないので予約できる（古い呼び方: p_auto を渡さない）
    expect((await reserveImages(aliceId, 4)).data?.[0]).toMatchObject({ status: "ok", user_monthly_limit: 20 });
    const { data: q } = await admin.rpc("ai_image_quota", { p_owner_id: aliceId, p_as_of: AS_OF, p_scope_owner: aliceId });
    expect(q?.[0]).toMatchObject({ user_month_images: 4, user_monthly_limit: 20 });
    const { data: qa } = await admin.rpc("ai_image_quota", { p_owner_id: aliceId, p_as_of: AS_OF, p_scope_owner: aliceId, p_auto: true });
    expect(qa?.[0]).toMatchObject({ user_month_images: 31, user_monthly_limit: 31 });
  });

  it("自動の分の全体は 月 $3（手でつくる分の $6.66 とは別）", async () => {
    expect((await reserveImages(aliceId, 1, { p_auto: true, p_cost_usd: 2.9 })).data?.[0]?.status).toBe("ok");
    expect((await reserveImages(aliceId, 1, { p_auto: true, p_cost_usd: 0.2 })).data?.[0]?.status).toBe("global_limit");
    expect((await reserveImages(aliceId, 1, { p_cost_usd: 0.2 })).data?.[0]?.status).toBe("ok");
  });

  it("登録して 7 日までは、自動の分は月 10 枚", async () => {
    const { data } = await admin.rpc("ai_image_quota", { p_owner_id: aliceId, p_as_of: new Date().toISOString(), p_scope_owner: aliceId, p_auto: true });
    expect(data?.[0]?.user_monthly_limit).toBe(10);
  });

  it("画像の場面の AI（auto_post_scene）は、自動の投稿の枠で予約できる", async () => {
    const { data } = await admin.rpc("reserve_ai_usage", { p_owner_id: aliceId, p_purpose: "auto_post_scene", p_cost_usd: 0.15, p_scope_owner: aliceId, p_as_of: AS_OF });
    expect(data?.[0]?.status).toBe("ok");
  });
});

describe("自動の回に画像を添える", () => {
  it("文から場面を書き、1 枚つくって AI の印を付けて添える。Instagram にも送る", async () => {
    await notice();
    const p = await project();
    await note(p, "新しい豆");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const runId = await dueRun(id, p);
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    const { data: run } = await admin.from("auto_runs").select("status, post_id").eq("id", runId).single();
    expect(run!.status).toBe("scheduled");
    const { data: media } = await admin.from("media_files").select("ai_generated, alt_text, storage_path").eq("post_id", run!.post_id!);
    expect(media).toHaveLength(1);
    expect(media![0]).toMatchObject({ ai_generated: true, alt_text: "木の机の上に、焙煎したコーヒー豆が広がっている" });
    expect(media![0].storage_path).toMatch(new RegExp(`^${aliceId}/[0-9a-f-]{36}\\.jpg$`));
    // 手でつくった AI の画像と同じく、画像の中に AI で作ったことの印（XMP の trainedAlgorithmicMedia）を入れる
    const { data: file } = await admin.storage.from("post-media").download(media![0].storage_path);
    expect(Buffer.from(await file!.arrayBuffer()).toString("latin1")).toContain("trainedAlgorithmicMedia");
    const { data: targets } = await admin.from("post_targets").select("sns").eq("post_id", run!.post_id!);
    expect(targets!.map((t) => t.sns).sort()).toEqual(["instagram", "threads"]);
    // 画像の AI には、場面と決まった注文だけを送る（投稿の本文は送らない）
    expect(prompts[0]).toContain("木の机の上に");
    expect(prompts[0]).not.toContain("焙煎の話");
    const { data: jobs } = await admin.from("ai_image_jobs").select("auto, status").eq("owner_id", aliceId);
    expect(jobs).toEqual([{ auto: true, status: "done" }]);
  });

  it("画像をつくれなかった回は下書きに回し（image_failed）、続けての失敗には数えない", async () => {
    await notice();
    const p = await project();
    await note(p, "メモ 1");
    await note(p, "メモ 2");
    const id = await plan(p);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    imageFails = true;
    const r1 = await dueRun(id, p);
    const r2 = await dueRun(id, p);
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    for (const r of [r1, r2]) expect((await admin.from("auto_runs").select("status, reason").eq("id", r).single()).data).toMatchObject({ status: "held", reason: "image_failed" });
    await reviewPlans(admin, deps(), new Date(), { ownerIds: [aliceId] });
    expect((await planOf(id)).status).toBe("active");
  });

  it("AI の画像の注意を読んだ印がなければ、画像をつくらずに下書きに回す", async () => {
    await notice();
    const p = await project();
    await note(p, "メモ");
    const id = await plan(p);
    await admin.from("ai_image_notices").delete().eq("owner_id", aliceId);
    await admin.from("auto_plans").update({ first_review: false }).eq("id", id);
    const r = await dueRun(id, p);
    await makeDueRuns(admin, deps(), new Date(), { ownerIds: [aliceId] });
    expect((await admin.from("auto_runs").select("status, reason").eq("id", r).single()).data).toMatchObject({ status: "held", reason: "image_failed" });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("見本の画像と、最初の回にする", () => {
  it("見本の画像をつくり（1 回だけ）、最初の回にすると、その画像を添える", async () => {
    await notice();
    const p = await project();
    await note(p, "見本のメモ");
    const planRow = { ...(await planOf(await plan(p))), id: NO_PLAN_ID };
    const s = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow });
    if (!s.ok || !s.sampleId) throw new Error("見本を作れませんでした");
    const img = await makeSampleImage(admin, deps(), { ownerId: aliceId, projectId: p, sampleId: s.sampleId });
    expect(img.ok).toBe(true);
    // 2 回目は同じ画像を返す（つくり直さない）
    const again = await makeSampleImage(admin, deps(), { ownerId: aliceId, projectId: p, sampleId: s.sampleId });
    expect(again.ok && img.ok && again.image.path).toBe(img.ok ? img.image.path : "");
    expect(generate).toHaveBeenCalledTimes(1);
    // ほかの人の見本の画像はつくれない
    expect((await makeSampleImage(admin, deps(), { ownerId: bobId, projectId: p, sampleId: s.sampleId })).ok).toBe(false);
    const id = await plan(p);
    const r = await adoptSample(admin, { ownerId: aliceId, planId: id, sampleId: s.sampleId });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, status: "scheduled" });
    const { data: run } = await admin.from("auto_runs").select("post_id").eq("plan_id", id).single();
    const { data: media } = await admin.from("media_files").select("ai_generated").eq("post_id", run!.post_id!);
    expect(media).toEqual([{ ai_generated: true }]);
  });

  it("注意が出た見本でも、画像はつくる（本番でどう見えるかを確かめるため。2026-11-21 オーナーの決定）。1 回目としては送れない", async () => {
    await notice();
    const p = await project();
    await note(p, "見本のメモ");
    const planRow = { ...(await planOf(await plan(p))), id: NO_PLAN_ID };
    const s = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow });
    if (!s.ok || !s.sampleId) throw new Error("見本を作れませんでした");
    // 送る前の確認で注意が出た見本にする（hold）
    { const { error } = await admin.from("auto_samples").update({ hold: { kind: "made_up", detail: "本当ですか" } }).eq("id", s.sampleId); if (error) throw error; }
    const before = vi.mocked(generate).mock.calls.length;
    const img = await makeSampleImage(admin, deps(), { ownerId: aliceId, projectId: p, sampleId: s.sampleId });
    expect(img.ok, JSON.stringify(img)).toBe(true);
    expect(vi.mocked(generate).mock.calls.length).toBe(before + 1);
    const r = await adoptSample(admin, { ownerId: aliceId, planId: await plan(p), sampleId: s.sampleId });
    expect(r.ok).toBe(false);
  });

  it("画像をつくれなかったときは ok: false を返す（画面は文だけ出す）", async () => {
    await notice();
    const p = await project();
    await note(p, "見本のメモ");
    const planRow = { ...(await planOf(await plan(p))), id: NO_PLAN_ID };
    const s = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow });
    if (!s.ok || !s.sampleId) throw new Error("見本を作れませんでした");
    imageFails = true;
    try {
      expect((await makeSampleImage(admin, deps(), { ownerId: aliceId, projectId: p, sampleId: s.sampleId })).ok).toBe(false);
    } finally {
      imageFails = false;
    }
    expect((await admin.from("auto_samples").select("image").eq("id", s.sampleId).single()).data!.image).toBeNull();
  });

  it("画像を選んだ回し方で、見本の画像をつくっていなければ、最初の回にしない", async () => {
    await notice();
    const p = await project();
    await note(p, "見本のメモ");
    const planRow = { ...(await planOf(await plan(p))), id: NO_PLAN_ID };
    const s = await makeSample(admin, deps(), { ownerId: aliceId, projectId: p, plan: planRow });
    if (!s.ok || !s.sampleId) throw new Error("見本を作れませんでした");
    const id = await plan(p);
    const r = await adoptSample(admin, { ownerId: aliceId, planId: id, sampleId: s.sampleId });
    expect(!r.ok && r.detail).toContain("画像がなかった");
  });
});
