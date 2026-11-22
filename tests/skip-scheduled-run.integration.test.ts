// 予約済みの自動の投稿を、その日だけ飛ばす（skip_scheduled_auto_run。20261121110000。2026-11-21 オーナーの指摘・PM の了承）。
// 本人の予約済み・確認待ちの回だけ。ほかの人の回・送り始めた回・時刻を過ぎた回は断る。運営者が止めている間も飛ばせる。
// 飛ばしたあと、ジョブが同じ時刻の回を作り直さない。行は本人の分だけで調べ、最後に 0 件になることを確かめる
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { addUpcomingRuns } from "@/lib/auto-post/engine";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;

const HOUR = 3_600_000;
const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

async function newPlan(client: TestClient, project: string): Promise<string> {
  const { data, error } = await client.rpc("save_auto_plan", {
    p_plan_id: null as unknown as string,
    p_project_id: project,
    p_name: "ネタ帳から",
    p_kind: "notes",
    p_materials: { note_order: "old_first" },
    p_targets: { threads: "auto", x: "review" },
    p_x_link: "never",
    p_schedule: { weekdays: [1, 2, 3, 4, 5, 6, 7], time: "19:00", every_weeks: 1, start: "2026-11-16" },
    p_instructions: [],
    p_lead_hours: 24,
    p_consent: true,
  });
  if (error) throw error;
  return data as string;
}

// 自動の回と、その投稿（サーバーが作るのと同じ形）。runId を渡すと、ジョブが足した回に投稿を付ける
async function runWithPost(planId: string, opts: { owner?: string; project?: string; dueAt?: string; status?: string; runId?: string; targets?: [string, string][] } = {}) {
  const owner = opts.owner ?? aliceId;
  const project = opts.project ?? projectId;
  let runId = opts.runId;
  let dueAt = opts.dueAt ?? later(30);
  if (runId) {
    dueAt = (await admin.from("auto_runs").select("due_at").eq("id", runId).single()).data!.due_at;
    await admin.from("auto_runs").update({ status: opts.status ?? "scheduled" }).eq("id", runId);
  } else {
    const { data, error } = await admin
      .from("auto_runs")
      .insert({ plan_id: planId, owner_id: owner, project_id: project, due_at: dueAt, generate_at: new Date().toISOString(), status: opts.status ?? "scheduled" })
      .select("id")
      .single();
    if (error) throw error;
    runId = data.id as string;
  }
  const { data: post, error: e2 } = await admin
    .from("posts")
    .insert({ project_id: project, owner_id: owner, body: `自動の投稿 ${randomUUID()}`, status: "scheduled", planned_at: dueAt, text_origin: "ai", auto_run_id: runId })
    .select("id")
    .single();
  if (e2) throw e2;
  await admin.from("auto_runs").update({ post_id: post.id }).eq("id", runId);
  for (const [sns, status] of opts.targets ?? [["threads", "pending"], ["x", "awaiting_approval"]]) {
    const { error: e3 } = await admin.from("post_targets").insert({ post_id: post.id, owner_id: owner, sns, status });
    if (e3) throw e3;
  }
  return { runId: runId!, postId: post.id as string, dueAt };
}

const runOf = async (id: string) => (await admin.from("auto_runs").select("status, reason").eq("id", id).single()).data!;
const postStatus = async (id: string) => (await admin.from("posts").select("status").eq("id", id).single()).data!.status;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  for (const id of [aliceId, bobId]) {
    const { error } = await admin.from("legal_consents").insert({ user_id: id, version: "2026-11-16", via: "signup" });
    if (error) throw error;
  }
  projectId = (await alice.from("projects").insert({ name: "飛ばす" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "べつの人" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await admin.from("auto_post_holds").delete().in("user_id", [aliceId, bobId]);
  await deleteUser(aliceId);
  await deleteUser(bobId);
  for (const table of ["auto_plans", "auto_runs", "posts", "post_targets"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
});

describe("予約済みの回を、その日だけ飛ばす（skip_scheduled_auto_run）", () => {
  it("本人の予約済みの回を飛ばすと、回は canceled・user_skipped、投稿は下書きに戻る。送る時刻を返す", async () => {
    const plan = await newPlan(alice, projectId);
    const r = await runWithPost(plan);
    const { data, error } = await alice.rpc("skip_scheduled_auto_run", { p_run_id: r.runId });
    expect(error).toBeNull();
    expect(new Date(data as string).getTime()).toBe(new Date(r.dueAt).getTime());
    expect(await runOf(r.runId)).toEqual({ status: "canceled", reason: "user_skipped" });
    expect(await postStatus(r.postId)).toBe("draft");
    // 2 回目は、もう予約済みではないので断る
    expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: r.runId })).error?.code).toBe("P0002");
  });

  it("確認待ち（review）の回も飛ばせる", async () => {
    const plan = await newPlan(alice, projectId);
    const r = await runWithPost(plan, { status: "review" });
    expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: r.runId })).error).toBeNull();
    expect(await runOf(r.runId)).toEqual({ status: "canceled", reason: "user_skipped" });
    expect(await postStatus(r.postId)).toBe("draft");
  });

  it("ほかの人の回・送り始めた回・送る時刻を過ぎた回・まだつくっていない回は断る。何も変えない", async () => {
    const plan = await newPlan(alice, projectId);
    const bobPlan = await newPlan(bob, bobProject);
    const theirs = await runWithPost(bobPlan, { owner: bobId, project: bobProject });
    expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: theirs.runId })).error?.code).toBe("P0002");
    expect(await runOf(theirs.runId)).toMatchObject({ status: "scheduled" });
    expect(await postStatus(theirs.postId)).toBe("scheduled");

    const sending = await runWithPost(plan, { targets: [["threads", "publishing"], ["x", "awaiting_approval"]] });
    expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: sending.runId })).error?.hint).toBe("auto_run_sending");
    expect(await runOf(sending.runId)).toMatchObject({ status: "scheduled" });
    expect(await postStatus(sending.postId)).toBe("scheduled");

    const past = await runWithPost(plan, { dueAt: later(-1) });
    expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: past.runId })).error?.code).toBe("P0002");
    expect(await runOf(past.runId)).toMatchObject({ status: "scheduled" });

    const { data: waiting } = await admin
      .from("auto_runs")
      .insert({ plan_id: plan, owner_id: aliceId, project_id: projectId, due_at: later(80), generate_at: later(56) })
      .select("id")
      .single();
    expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: waiting!.id })).error?.code).toBe("P0002");
    expect(await runOf(waiting!.id)).toMatchObject({ status: "waiting" });
  });

  it("ログインしていない人は呼べない", async () => {
    const plan = await newPlan(alice, projectId);
    const r = await runWithPost(plan);
    expect((await anonClient().rpc("skip_scheduled_auto_run", { p_run_id: r.runId })).error?.code).toBe("42501");
    expect(await runOf(r.runId)).toMatchObject({ status: "scheduled" });
  });

  it("運営者が止めている間も飛ばせる（送るのを減らす操作なので）", async () => {
    const plan = await newPlan(alice, projectId);
    const r = await runWithPost(plan);
    await admin.from("auto_post_holds").insert({ user_id: aliceId, reason: "テスト", held_by: "test" });
    try {
      expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: r.runId })).error).toBeNull();
    } finally {
      await admin.from("auto_post_holds").delete().eq("user_id", aliceId);
    }
    expect(await runOf(r.runId)).toEqual({ status: "canceled", reason: "user_skipped" });
    expect(await postStatus(r.postId)).toBe("draft");
  });

  it("飛ばしたあと、ジョブ（これからの回を足す）は同じ時刻の回を作り直さない", async () => {
    const project = (await alice.from("projects").insert({ name: "作り直さない" }).select("id").single()).data!.id;
    const plan = await newPlan(alice, project);
    await addUpcomingRuns(admin, new Date(), { ownerIds: [aliceId] });
    const first = (await admin.from("auto_runs").select("id, due_at").eq("plan_id", plan).order("due_at").limit(1).single()).data!;
    const r = await runWithPost(plan, { project, runId: first.id });
    expect((await alice.rpc("skip_scheduled_auto_run", { p_run_id: r.runId })).error).toBeNull();
    const before = (await admin.from("auto_runs").select("id").eq("plan_id", plan)).data!.length;
    await addUpcomingRuns(admin, new Date(), { ownerIds: [aliceId] });
    const same = (await admin.from("auto_runs").select("id, status").eq("plan_id", plan).eq("due_at", first.due_at)).data!;
    expect(same).toEqual([{ id: r.runId, status: "canceled" }]);
    expect((await admin.from("auto_runs").select("id").eq("plan_id", plan)).data!.length).toBe(before);
  });
});

// M2（docs/security/2026-11-21_セキュリティ確認.md）: 飛ばす・止めると送信のジョブ（claim_due_targets）を並べて走らせても、
// 送られる投稿を「飛ばした・止めた」にしない。どちらが先でも、結果は「飛ばした・下書き・送らない」か「送る・回はそのまま」のどちらか
const targetStatuses = async (postId: string) => (await admin.from("post_targets").select("status").eq("post_id", postId)).data!.map((t) => t.status);
const claim = (postId: string) => admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: postId });

describe("送信のジョブと同時に飛ばす・止める（M2）", () => {
  // 回し方は 1 プロジェクト 10 個までなので、止めるテストは別のプロジェクトで
  let pauseProject: string;
  beforeAll(async () => {
    pauseProject = (await alice.from("projects").insert({ name: "止める" }).select("id").single()).data!.id;
  });

  it("飛ばすのと送るのを並べて走らせても、送った投稿を「飛ばした」にしない", async () => {
    const plan = await newPlan(alice, projectId);
    for (let i = 0; i < 12; i++) {
      const r = await runWithPost(plan, { dueAt: later(30 + i), targets: [["threads", "pending"]] });
      const [skip, claimed] = await Promise.all([alice.rpc("skip_scheduled_auto_run", { p_run_id: r.runId }), claim(r.postId)]);
      expect(claimed.error).toBeNull();
      const sent = (claimed.data ?? []).length > 0;
      if (sent) {
        expect(skip.error?.hint, `${i}`).toBe("auto_run_sending");
        expect(await runOf(r.runId)).toMatchObject({ status: "scheduled" });
        expect(await postStatus(r.postId)).toBe("scheduled");
        expect(await targetStatuses(r.postId)).toEqual(["publishing"]);
      } else {
        expect(skip.error, `${i}`).toBeNull();
        expect(await runOf(r.runId)).toEqual({ status: "canceled", reason: "user_skipped" });
        expect(await postStatus(r.postId)).toBe("draft");
        expect(await targetStatuses(r.postId)).toEqual(["pending"]);
      }
    }
  });

  it("回し方を止める（下書きに戻す）のと送るのを並べて走らせても、送った投稿の回は止めない", async () => {
    for (let i = 0; i < 6; i++) {
      const plan = await newPlan(alice, pauseProject);
      const r = await runWithPost(plan, { project: pauseProject, dueAt: later(30 + i), targets: [["threads", "pending"]] });
      const [pause, claimed] = await Promise.all([
        alice.rpc("set_auto_plan_status", { p_project_id: pauseProject, p_plan_id: plan, p_status: "paused", p_to_draft: true }),
        claim(r.postId),
      ]);
      expect(pause.error).toBeNull();
      expect(claimed.error).toBeNull();
      if ((claimed.data ?? []).length > 0) {
        expect((await runOf(r.runId)).status, `${i}`).toBe("scheduled");
        expect(await postStatus(r.postId)).toBe("scheduled");
        expect(await targetStatuses(r.postId)).toEqual(["publishing"]);
      } else {
        expect(await runOf(r.runId), `${i}`).toEqual({ status: "canceled", reason: "plan_paused" });
        expect(await postStatus(r.postId)).toBe("draft");
        expect(await targetStatuses(r.postId)).toEqual(["pending"]);
      }
    }
  });

  it("送り始めた投稿の回は、止めても「止めた」にしない（ジョブが先に終わったとき）", async () => {
    const plan = await newPlan(alice, pauseProject);
    const r = await runWithPost(plan, { project: pauseProject, targets: [["threads", "publishing"]] });
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: pauseProject, p_plan_id: plan, p_status: "paused", p_to_draft: true })).error).toBeNull();
    expect((await runOf(r.runId)).status).toBe("scheduled");
    expect(await postStatus(r.postId)).toBe("scheduled");
  });
});
