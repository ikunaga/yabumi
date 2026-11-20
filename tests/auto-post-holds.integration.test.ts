// 運営者が利用者ごとに自動の投稿を止める（20261118100000_auto_post_holds。docs/design/auto-post.md の「運営者が止める」）。
// 他人から読めない・本人も理由を読めない・本人が書けない・運営者の関数を呼べない、止めている間に断るもの・断らないもの、
// ジョブ（回の取り出し・送信・AI の予約・回を足す・知らせ）、解除。テストの行はこのファイルの利用者だけに作る（共有のローカル DB）。最後に 0 件を確かめる
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallCheck } from "@/lib/ai/ai-check";
import type { AutoPostGenerator } from "@/lib/auto-post/ai";
import { addUpcomingRuns, notifyHolds, remindApprovals, type EngineDeps } from "@/lib/auto-post/engine";
import { heldUserIds, isAutoPostHeld, myAutoPostHold } from "@/lib/auto-post/holds";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceEmail: string;
let bobEmail: string;

const HOUR = 3_600_000;
const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const scopeOpts = () => ({ ownerIds: [aliceId, bobId] });

const generator: AutoPostGenerator = vi.fn(async () => ({ ok: false as const, reason: "cannot_write" as const, detail: "使わない" }));
const callCheck: CallCheck = vi.fn(async () => ({ output: { summary: "よい", findings: [] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 } }));
const push = vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 }));
const deps = (): EngineDeps => ({ generator, callCheck, push });

const planArgs = (projectId: string, over: Record<string, unknown> = {}) => ({
  p_plan_id: null as unknown as string,
  p_project_id: projectId,
  p_name: "ネタ帳から",
  p_kind: "notes",
  p_materials: { note_order: "old_first" },
  p_targets: { threads: "auto", x: "review" },
  p_x_link: "never",
  p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "19:00", every_weeks: 1, start: "2026-11-16" },
  p_instructions: [],
  p_lead_hours: 24,
  p_consent: true,
  ...over,
});

async function newProject(client = alice): Promise<string> {
  const { data, error } = await client.from("projects").insert({ name: `止める ${randomUUID().slice(0, 4)}` }).select("id").single();
  if (error) throw error;
  return data.id;
}
async function newPlan(client = alice): Promise<{ planId: string; projectId: string }> {
  const projectId = await newProject(client);
  const { data, error } = await client.rpc("save_auto_plan", planArgs(projectId));
  if (error) throw error;
  return { planId: data as string, projectId };
}

// 自動の回と、その投稿（サーバーが作るのと同じ形）
async function runWithPost(planId: string, projectId: string, opts: { status?: string; postStatus?: string; dueAt?: string; targets?: [string, string][]; owner?: string } = {}) {
  const owner = opts.owner ?? aliceId;
  const dueAt = opts.dueAt ?? later(24);
  const { data: run, error } = await admin
    .from("auto_runs")
    .insert({ plan_id: planId, owner_id: owner, project_id: projectId, due_at: dueAt, generate_at: new Date().toISOString(), status: opts.status ?? "scheduled" })
    .select("id")
    .single();
  if (error) throw error;
  const { data: post, error: e2 } = await admin
    .from("posts")
    .insert({ project_id: projectId, owner_id: owner, body: `自動投稿 ${randomUUID()}`, status: opts.postStatus ?? "scheduled", planned_at: dueAt, text_origin: "ai", auto_run_id: run!.id })
    .select("id")
    .single();
  if (e2) throw e2;
  await admin.from("auto_runs").update({ post_id: post!.id }).eq("id", run!.id);
  const targets: Record<string, string> = {};
  for (const [sns, status] of opts.targets ?? [["threads", "pending"], ["x", "awaiting_approval"]]) {
    const { data: t, error: e3 } = await admin.from("post_targets").insert({ post_id: post!.id, owner_id: owner, sns, status }).select("id").single();
    if (e3) throw e3;
    targets[sns] = t!.id;
  }
  return { runId: run!.id, postId: post!.id, targets };
}

const hold = (email = aliceEmail, reason = "テストで止める") => admin.rpc("operator_hold_auto_post", { p_email: email, p_reason: reason, p_by: "sql" });
const release = (email = aliceEmail) => admin.rpc("operator_release_auto_post", { p_email: email, p_reason: "テストで解除", p_by: "sql" });
const statusOf = async (targetId: string) => (await admin.from("post_targets").select("status").eq("id", targetId).maybeSingle()).data?.status;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  aliceEmail = (await admin.auth.admin.getUserById(aliceId)).data.user!.email!;
  bobEmail = (await admin.auth.admin.getUserById(bobId)).data.user!.email!;
  const { error } = await admin.from("legal_consents").insert([
    { user_id: aliceId, version: "2026-11-16", via: "signup" },
    { user_id: bobId, version: "2026-11-16", via: "signup" },
  ]);
  if (error) throw error;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
  // 退会で、止めた記録も一緒に消える
  const { count } = await admin.from("auto_post_holds").select("*", { count: "exact", head: true }).in("user_id", [aliceId, bobId]);
  expect(count).toBe(0);
  for (const table of ["auto_plans", "auto_runs", "post_target_approvals"] as const) {
    const { count: c } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(c).toBe(0);
  }
});

describe("止めた記録の権限", () => {
  it("止める・解除する・一覧の関数と、止めているかの関数は、利用者もログインしていない人も呼べない", async () => {
    for (const client of [alice, anonClient()]) {
      expect((await client.rpc("operator_hold_auto_post", { p_email: aliceEmail, p_reason: "x", p_by: "x" })).error?.code).toBe("42501");
      expect((await client.rpc("operator_release_auto_post", { p_email: aliceEmail, p_reason: "x", p_by: "x" })).error?.code).toBe("42501");
      expect((await client.rpc("operator_auto_post_holds")).error?.code).toBe("42501");
      expect((await client.rpc("auto_post_held", { p_uid: bobId })).error?.code).toBe("42501");
    }
  });

  it("本人は日時だけ読める（理由・だれが止めたかは読めない）。ほかの人の行は見えない。書き込めない", async () => {
    expect((await hold(bobEmail, "ほかの人の理由")).error).toBeNull();
    try {
      // 本人
      const own = await bob.from("auto_post_holds").select("id, user_id, held_at, released_at");
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);
      expect((await bob.from("auto_post_holds").select("reason")).error?.code).toBe("42501");
      expect((await bob.from("auto_post_holds").select("held_by")).error?.code).toBe("42501");
      expect(await myAutoPostHold(bob)).toMatchObject({ heldAt: own.data![0].held_at });
      // ほかの人
      expect((await alice.from("auto_post_holds").select("id")).data).toEqual([]);
      expect(await myAutoPostHold(alice)).toBeNull();
      // 本人が外す・消す・作ることはできない
      const id = own.data![0].id;
      expect((await bob.from("auto_post_holds").update({ released_at: new Date().toISOString() }).eq("id", id)).error?.code).toBe("42501");
      expect((await bob.from("auto_post_holds").delete().eq("id", id)).error?.code).toBe("42501");
      expect((await bob.from("auto_post_holds").insert({ user_id: bobId, reason: "x", held_by: "x" })).error?.code).toBe("42501");
      expect((await anonClient().from("auto_post_holds").select("id")).error?.code).toBe("42501");
      expect(await isAutoPostHeld(admin, bobId)).toBe(true);
    } finally {
      expect((await release(bobEmail)).error).toBeNull();
    }
    expect(await isAutoPostHeld(admin, bobId)).toBe(false);
  });

  it("理由・運営者は 1〜200 字・1〜254 字。知らないメールアドレスは P0002", async () => {
    expect((await hold(aliceEmail, " ")).error?.code).toBe("22023");
    expect((await hold(aliceEmail, "あ".repeat(201))).error?.code).toBe("22023");
    expect((await admin.rpc("operator_hold_auto_post", { p_email: aliceEmail, p_reason: "x", p_by: "" })).error?.code).toBe("22023");
    expect((await hold(`nobody-${randomUUID()}@example.com`)).error?.code).toBe("P0002");
    expect(await isAutoPostHeld(admin, aliceId)).toBe(false);
  });
});

describe("止めている間", () => {
  it("止めると、まだ送っていない回を取り消し、投稿を下書きに戻す。送った回には触らない。2 回止めても行は 1 つ", async () => {
    const { planId, projectId } = await newPlan();
    const scheduled = await runWithPost(planId, projectId, { dueAt: later(30) });
    const waiting = (await admin.from("auto_runs").insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: later(60), generate_at: later(36), status: "waiting" }).select("id").single()).data!;
    const sent = await runWithPost(planId, projectId, { dueAt: later(-2), targets: [["threads", "published"]] });
    try {
      const { data, error } = await hold();
      expect(error).toBeNull();
      expect(data![0]).toMatchObject({ already_held: false, canceled_runs: 2 });
      const runs = (await admin.from("auto_runs").select("id, status, reason").in("id", [scheduled.runId, waiting.id, sent.runId])).data!;
      expect(runs.find((r) => r.id === scheduled.runId)).toMatchObject({ status: "canceled", reason: "operator_hold" });
      expect(runs.find((r) => r.id === waiting.id)).toMatchObject({ status: "canceled", reason: "operator_hold" });
      expect(runs.find((r) => r.id === sent.runId)!.status).toBe("scheduled");
      expect((await admin.from("posts").select("status").eq("id", scheduled.postId).single()).data!.status).toBe("draft");
      expect((await admin.from("posts").select("status").eq("id", sent.postId).single()).data!.status).toBe("scheduled");
      expect(await statusOf(sent.targets.threads)).toBe("published");
      // もう一度止めても、前の行のまま
      const again = await hold(aliceEmail, "別の理由");
      expect(again.data![0]).toMatchObject({ hold_id: data![0].hold_id, already_held: true, canceled_runs: 0 });
      expect((await admin.from("auto_post_holds").select("reason").eq("user_id", aliceId).is("released_at", null)).data).toEqual([{ reason: "テストで止める" }]);
    } finally {
      await release();
    }
  });

  it("作る・直す・再開・送る・承認・自動の投稿の送り直しを 42501 で断る。プロジェクトを作り直しても作れない", async () => {
    const { planId, projectId } = await newPlan();
    const review = await runWithPost(planId, projectId, { status: "review", postStatus: "draft", dueAt: later(30) });
    await hold();
    try {
      // 印は利用者に付くので、新しいプロジェクトでも作れない
      const fresh = await newProject();
      const created = await alice.rpc("save_auto_plan", planArgs(fresh));
      expect(created.error?.code).toBe("42501");
      expect(created.error?.hint).toBe("auto_post_hold");
      expect((await alice.rpc("save_auto_plan", planArgs(projectId, { p_plan_id: planId }))).error?.hint).toBe("auto_post_hold");
      // 止める（一時停止）はできる。再開は断る
      expect((await alice.rpc("set_auto_plan_status", { p_project_id: projectId, p_plan_id: planId, p_status: "paused" })).error).toBeNull();
      expect((await alice.rpc("set_auto_plan_status", { p_project_id: projectId, p_plan_id: planId, p_status: "active" })).error?.hint).toBe("auto_post_hold");
      // 送る方向の承認は断る（止めたときに回は取り消されているので、確かめ待ちの回を作り直して試す）
      await admin.from("auto_runs").update({ status: "review", reason: null }).eq("id", review.runId);
      const { data: pv } = await alice.rpc("auto_target_previews", { p_post_id: review.postId });
      const fp = Object.fromEntries(pv!.map((r) => [r.target_id, r.fingerprint]));
      expect((await alice.rpc("review_auto_run", { p_run_id: review.runId, p_send: true, p_fingerprints: fp })).error?.hint).toBe("auto_post_hold");
      expect((await alice.rpc("approve_auto_target", { p_target_id: review.targets.x, p_fingerprint: fp[review.targets.x] })).error?.hint).toBe("auto_post_hold");
      expect(await statusOf(review.targets.x)).toBe("awaiting_approval");
      // 送らない・承認しない・飛ばす・消すはできる
      expect((await alice.rpc("decline_auto_target", { p_target_id: review.targets.x })).error).toBeNull();
      expect((await alice.rpc("review_auto_run", { p_run_id: review.runId, p_send: false })).error).toBeNull();
      expect((await alice.rpc("skip_next_auto_run", { p_plan_id: planId })).error).toBeNull();
      // 送り直し: 自動で作った投稿は断る。手で作った投稿はできる
      const failed = await runWithPost(planId, projectId, { targets: [["threads", "failed"]] });
      expect((await alice.rpc("requeue_failed_targets", { p_post_id: failed.postId, p_sns: ["threads"] })).error?.hint).toBe("auto_post_hold");
      const { data: manual } = await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "手で書いた", status: "scheduled", planned_at: later(5) }).select("id").single();
      await admin.from("post_targets").insert({ post_id: manual!.id, owner_id: aliceId, sns: "threads", status: "failed" });
      expect((await alice.rpc("requeue_failed_targets", { p_post_id: manual!.id, p_sns: ["threads"] })).error).toBeNull();
      expect((await alice.rpc("delete_auto_plan", { p_plan_id: planId })).error).toBeNull();
    } finally {
      await release();
    }
  });

  it("ジョブ: 回を取り出さない・足さない、自動で作った投稿を送らない（手で作った投稿は送る）、自動の投稿の AI を断る（ふだんの AI はよい）", async () => {
    const { planId, projectId } = await newPlan();
    await hold();
    try {
      // 作る時刻が来た回（止めたあとに入った）
      await admin.from("auto_runs").insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: later(3), generate_at: later(-1), status: "waiting" });
      expect((await admin.rpc("claim_due_auto_runs", { p_limit: 5, p_owner_ids: [aliceId] })).data).toEqual([]);
      // 回を足さない（止める前の規則のまま、active の回し方がある）
      const before = (await admin.from("auto_runs").select("id", { count: "exact", head: true }).eq("plan_id", planId)).count;
      await addUpcomingRuns(admin, new Date(), { ownerIds: [aliceId] });
      expect((await admin.from("auto_runs").select("id", { count: "exact", head: true }).eq("plan_id", planId)).count).toBe(before);
      // 送信: 自動で作った投稿の Threads（承認の要らない SNS）も送らない
      const auto = await runWithPost(planId, projectId, { targets: [["threads", "pending"]] });
      await admin.from("posts").update({ planned_at: later(-0.1) }).eq("id", auto.postId);
      expect((await admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: auto.postId })).data).toEqual([]);
      expect(await statusOf(auto.targets.threads)).toBe("pending");
      const { data: manual } = await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "手で書いた", status: "scheduled", planned_at: later(-0.1) }).select("id").single();
      await admin.from("post_targets").insert({ post_id: manual!.id, owner_id: aliceId, sns: "threads", status: "pending" });
      const sent = (await admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: manual!.id })).data!;
      expect(sent.map((r) => r.sns)).toEqual(["threads"]);
      await admin.from("post_targets").update({ status: "failed", locked_at: null }).eq("post_id", manual!.id);
      // AI の予約
      const reserve = (purpose: string) => admin.rpc("reserve_ai_usage", { p_owner_id: aliceId, p_purpose: purpose, p_cost_usd: 0.2, p_scope_owner: aliceId });
      for (const purpose of ["auto_post", "auto_post_check"]) {
        const r = await reserve(purpose);
        expect(r.error).toBeNull();
        expect(r.data![0]).toMatchObject({ usage_id: null, status: "auto_post_hold" });
      }
      const normal = await reserve("consult");
      expect(normal.data![0].status).toBe("ok");
      await admin.from("ai_usage").delete().eq("id", normal.data![0].usage_id!);
    } finally {
      await release();
    }
  });

  it("ほかの人は止まらない", async () => {
    const { planId, projectId } = await newPlan(bob);
    await hold();
    try {
      expect((await bob.rpc("save_auto_plan", planArgs(projectId, { p_plan_id: planId }))).error).toBeNull();
      await admin.from("auto_runs").insert({ plan_id: planId, owner_id: bobId, project_id: projectId, due_at: later(3), generate_at: later(-1), status: "waiting" });
      const claimed = (await admin.rpc("claim_due_auto_runs", { p_limit: 5, p_owner_ids: [bobId] })).data!;
      expect(claimed).toHaveLength(1);
      await admin.from("auto_runs").update({ status: "skipped", reason: "error", locked_at: null }).eq("id", claimed[0].id);
      expect([...(await heldUserIds(admin, [aliceId, bobId]))]).toEqual([aliceId]);
    } finally {
      await release();
    }
  });
});

describe("解除", () => {
  it("解除すると作れる。動いている回し方は最初の回をまた確かめる。止めたときに取り消した、投稿を作る前の回は消す。記録は残る", async () => {
    const { planId, projectId } = await newPlan();
    await admin.from("auto_plans").update({ first_review: false }).eq("id", planId);
    const waiting = (await admin.from("auto_runs").insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: later(80), generate_at: later(56), status: "waiting" }).select("id").single()).data!;
    const scheduled = await runWithPost(planId, projectId, { dueAt: later(90) });
    await hold();
    const { data, error } = await release();
    expect(error).toBeNull();
    expect(data![0].released).toBe(true);
    expect((await admin.from("auto_plans").select("first_review, status").eq("id", planId).single()).data).toEqual({ first_review: true, status: "active" });
    expect((await admin.from("auto_runs").select("id").eq("id", waiting.id)).data).toEqual([]);
    // 投稿を作った回は残る（投稿は下書きのまま。利用者が見て予約し直す）
    expect((await admin.from("auto_runs").select("status").eq("id", scheduled.runId).single()).data!.status).toBe("canceled");
    expect((await alice.rpc("save_auto_plan", planArgs(await newProject()))).error).toBeNull();
    // 記録は残る（いま止めているものはない）
    const rows = (await admin.from("auto_post_holds").select("released_at, release_reason, released_by").eq("user_id", aliceId)).data!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.released_at && r.release_reason === "テストで解除" && r.released_by === "sql")).toBe(true);
    // 止めていない人の解除は何もしない
    expect((await release()).data![0]).toMatchObject({ hold_id: null, released: false });
  });
});

describe("知らせ（ジョブ）", () => {
  it("止めた・解除したを 1 回ずつ通知する。文に理由は入れない。止めている人には承認の知らせを送らない", async () => {
    push.mockClear();
    await admin.from("auto_post_holds").update({ hold_notified_at: new Date().toISOString(), release_notified_at: new Date().toISOString() }).in("user_id", [aliceId, bobId]);
    const { planId, projectId } = await newPlan();
    await hold(aliceEmail, "秘密の理由");
    // 止めたあとに残った確かめ待ちの回（止める前に作られた、などの形）
    const review = await runWithPost(planId, projectId, { status: "review", postStatus: "draft", dueAt: later(1) });
    expect(await remindApprovals(admin, deps(), new Date(), scopeOpts())).toBe(0);
    expect(await notifyHolds(admin, deps(), new Date(), scopeOpts())).toBe(1);
    expect(push).toHaveBeenCalledTimes(1);
    const [, user, msg] = push.mock.calls[0] as unknown as [unknown, string, { title: string; body: string }];
    expect(user).toBe(aliceId);
    expect(msg.title).toBe("自動投稿を止めました");
    expect(JSON.stringify(msg)).not.toContain("秘密の理由");
    // 2 回目は送らない
    expect(await notifyHolds(admin, deps(), new Date(), scopeOpts())).toBe(0);
    await release();
    expect(await notifyHolds(admin, deps(), new Date(), scopeOpts())).toBe(1);
    expect((push.mock.calls[1] as unknown as [unknown, string, { title: string }])[2].title).toBe("自動投稿を再開できます");
    expect(await notifyHolds(admin, deps(), new Date(), scopeOpts())).toBe(0);
    await admin.from("auto_runs").update({ reminded_at: new Date().toISOString() }).eq("id", review.runId);
  });

  it("知らせる前に解除したときは、どちらも送らない", async () => {
    push.mockClear();
    await hold();
    await release();
    expect(await notifyHolds(admin, deps(), new Date(), scopeOpts())).toBe(0);
    expect(push).not.toHaveBeenCalled();
  });
});
