// 2026-11-18 の PM のセキュリティ確認の DB の Low（20261118100000_auto_post_holds の 6.）。テストの行はこのファイルの利用者だけに作る（共有のローカル DB）
// L1: 指紋の合わない承認の pending は、送信ジョブが黙って飛ばさずに確かめ待ちに戻す
// L2: 承認のあとに画像の代替テキストを変えたら、確かめ待ちに戻る
// L3: 回し方を運営者が止めている回は、送る方向の承認を断る
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const HOUR = 3_600_000;
const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const planArgs = (over: Record<string, unknown> = {}) => ({
  p_plan_id: null as unknown as string,
  p_project_id: projectId,
  p_name: "ネタ帳から",
  p_kind: "notes",
  p_materials: { note_order: "old_first" },
  p_targets: { threads: "auto", x: "review" },
  p_x_link: "never",
  p_schedule: { weekdays: [2, 5], time: "19:00", every_weeks: 1, start: "2026-11-16" },
  p_instructions: [],
  p_lead_hours: 24,
  p_consent: true,
  ...over,
});

const planProject = new Map<string, string>();
// 1 人 10 プロジェクト・1 プロジェクト 10 件の上限があるので、プロジェクトに 9 件ずつ入れて、いっぱいになったら新しく作る
let pool: { id: string; used: number } | null = null;
async function poolProject(): Promise<string> {
  if (!pool || pool.used >= 9) {
    const { data, error } = await alice.from("projects").insert({ name: "自動の投稿" }).select("id").single();
    if (error) throw error;
    pool = { id: data.id, used: 0 };
  }
  pool.used++;
  return pool.id;
}

// 回し方を 1 つ作る。プロジェクトを渡さなければ新しく作る（1 プロジェクト 10 件の上限に、テストどうしで届かないように）
async function newPlan(client = alice, over: Record<string, unknown> = {}): Promise<string> {
  const project = (over.p_project_id as string | undefined) ?? (await poolProject());
  const { data, error } = await client.rpc("save_auto_plan", planArgs({ ...over, p_project_id: project }));
  if (error) throw error;
  planProject.set(data as string, project);
  return data as string;
}

// 自動の回と、その投稿（サーバーが作るのと同じ形）。targets: [sns, status]
async function runWithPost(planId: string, opts: { status?: string; postStatus?: string; dueAt?: string; targets?: [string, string][]; owner?: string; project?: string } = {}) {
  const owner = opts.owner ?? aliceId;
  const project = opts.project ?? planProject.get(planId) ?? projectId;
  const dueAt = opts.dueAt ?? later(24);
  const { data: run, error } = await admin
    .from("auto_runs")
    .insert({ plan_id: planId, owner_id: owner, project_id: project, due_at: dueAt, generate_at: new Date().toISOString(), status: opts.status ?? "scheduled" })
    .select("id")
    .single();
  if (error) throw error;
  const { data: post, error: e2 } = await admin
    .from("posts")
    .insert({ project_id: project, owner_id: owner, body: `自動の投稿 ${randomUUID()}`, status: opts.postStatus ?? "scheduled", planned_at: dueAt, text_origin: "ai", auto_run_id: run!.id })
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

const previews = async (postId: string, client = alice) => {
  const { data, error } = await client.rpc("auto_target_previews", { p_post_id: postId });
  if (error) throw error;
  return Object.fromEntries(data!.map((r) => [r.sns, r]));
};
const statusOf = async (targetId: string) => (await admin.from("post_targets").select("status").eq("id", targetId).maybeSingle()).data?.status;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "自動の投稿" }).select("id").single()).data!.id;
  const { error } = await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  if (error) throw error;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
  for (const table of ["auto_plans", "auto_runs", "post_target_approvals"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
});

describe("L1: 指紋の合わない承認", () => {
  it("送信ジョブは、自動で作った投稿の X の、いまの中身に合わない承認の pending を、確かめ待ちに戻して承認を消す", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id, { targets: [["threads", "pending"], ["x", "pending"]] });
    await admin.from("post_target_approvals").insert({ post_target_id: targets.x, owner_id: aliceId, fingerprint: "0".repeat(64) });
    await admin.from("posts").update({ planned_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", postId);
    const { data, error } = await admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: postId });
    expect(error).toBeNull();
    // Threads は送る。X は送らず、確かめ待ちに戻る
    expect(data!.map((r) => r.sns)).toEqual(["threads"]);
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    expect((await admin.from("post_target_approvals").select("post_target_id").eq("post_target_id", targets.x)).data).toEqual([]);
  });

  it("いまの中身に合う承認がある X は、そのまま送る", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id, { targets: [["x", "awaiting_approval"]] });
    const pv = await previews(postId);
    expect((await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint })).error).toBeNull();
    await admin.from("posts").update({ planned_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", postId);
    const { data } = await admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: postId });
    expect(data!.map((r) => r.sns)).toEqual(["x"]);
  });
});

describe("L2: 画像の代替テキスト", () => {
  it("承認のあとに代替テキストを変えたら、確かめ待ちに戻る", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id, { targets: [["x", "awaiting_approval"]] });
    const { data: m } = await admin
      .from("media_files")
      .insert({ owner_id: aliceId, post_id: postId, storage_path: `${aliceId}/${randomUUID()}.jpg`, width: 10, height: 10, size_bytes: 100, alt_text: "犬" })
      .select("id")
      .single();
    const pv = await previews(postId);
    expect((await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint })).error).toBeNull();
    expect(await statusOf(targets.x)).toBe("pending");
    await admin.from("media_files").update({ alt_text: "猫" }).eq("id", m!.id);
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    // 代替テキストが違えば指紋も違う
    expect((await previews(postId)).x.fingerprint).not.toBe(pv.x.fingerprint);
    await admin.from("media_files").delete().eq("id", m!.id);
  });
});

describe("L3: 回し方を運営者が止めている回", () => {
  it("最初の回の確かめの「送る」と、X の承認を 42501 で断る。送らないはできる", async () => {
    const id = await newPlan();
    const { runId, postId, targets } = await runWithPost(id, { status: "review", postStatus: "draft", targets: [["threads", "pending"], ["x", "awaiting_approval"]] });
    await admin.from("auto_plans").update({ status: "stopped", stop_reason: "operator" }).eq("id", id);
    const pv = await previews(postId);
    const send = await alice.rpc("review_auto_run", { p_run_id: runId, p_send: true, p_fingerprints: { [targets.x]: pv.x.fingerprint } });
    expect(send.error?.code).toBe("42501");
    expect(send.error?.hint).toBe("auto_plan_operator_stop");
    const approve = await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint });
    expect(approve.error?.code).toBe("42501");
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    expect((await admin.from("posts").select("status").eq("id", postId).single()).data!.status).toBe("draft");
    expect((await alice.rpc("review_auto_run", { p_run_id: runId, p_send: false })).error).toBeNull();
  });
});
