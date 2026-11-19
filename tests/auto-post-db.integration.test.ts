// 自動の投稿の表と関数（docs/design/auto-post.md の 2.2・2.3。20261116100000_auto_post）。
// 他人から読めない・利用者が状態や承認を書けない、保存の関数の確かめ、確かめて送る（承認・指紋・送信ジョブが取り出さない）、
// 止める・飛ばす・消す、作る回の取り出し。テストの行はこのファイルの利用者だけに作る（共有のローカル DB）。最後に 0 件を確かめる
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "自動の投稿" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "べつの人" }).select("id").single()).data!.id;
  // 同意の版はサーバーが legal_consents から決める（alice だけ同意している）
  const { error } = await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  if (error) throw error;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
  // 消したあとに、テストの行が残っていないこと
  for (const table of ["auto_plans", "auto_runs", "project_events", "post_target_approvals"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
});

describe("保存（save_auto_plan）", () => {
  it("同意の日時と版はサーバーが決める。利用者は表に直接は書けない", async () => {
    const id = await newPlan();
    const { data } = await alice.from("auto_plans").select("owner_id, consent_version, consented_at, status, first_review").eq("id", id).single();
    expect(data).toMatchObject({ owner_id: aliceId, consent_version: "2026-11-16", status: "active", first_review: true });
    expect((await alice.from("auto_plans").update({ status: "active", fail_streak: 0 }).eq("id", id)).error?.code).toBe("42501");
    expect((await alice.from("auto_plans").insert({ project_id: projectId, owner_id: aliceId, name: "x", kind: "notes", targets: { threads: "auto" }, schedule: {}, consented_at: new Date().toISOString(), consent_version: "2026-11-16" })).error?.code).toBe("42501");
    expect((await alice.from("auto_plans").delete().eq("id", id)).error?.code).toBe("42501");
  });

  it("同意なし・規約に同意していない人・ほかの人のプロジェクトは断る", async () => {
    expect((await alice.rpc("save_auto_plan", planArgs({ p_consent: false }))).error?.hint).toBe("consent_required");
    expect((await bob.rpc("save_auto_plan", planArgs({ p_project_id: bobProject }))).error?.hint).toBe("legal_consent_missing");
    expect((await bob.rpc("save_auto_plan", planArgs())).error?.code).toBe("P0002");
  });

  it("SNS ごとに決まった送り方だけ（X は確かめて送る、note は手で投稿）", async () => {
    expect((await alice.rpc("save_auto_plan", planArgs({ p_targets: { x: "auto" } }))).error?.code).toBe("22023");
    expect((await alice.rpc("save_auto_plan", planArgs({ p_targets: { note: "auto" } }))).error?.code).toBe("22023");
    expect((await alice.rpc("save_auto_plan", planArgs({ p_targets: { mastodon: "auto" } }))).error?.code).toBe("22023");
    expect((await alice.rpc("save_auto_plan", planArgs({ p_targets: {} }))).error?.code).toBe("22023");
  });

  it("くり返しの規則と材料を確かめる。ほかの人のフォーマット・行き先は指せない", async () => {
    expect((await alice.rpc("save_auto_plan", planArgs({ p_schedule: { weekdays: [2], time: "19:10", every_weeks: 1, start: "2026-11-16" } }))).error?.code).toBe("22023");
    expect((await alice.rpc("save_auto_plan", planArgs({ p_schedule: { weekdays: [8], time: "19:00", every_weeks: 1, start: "2026-11-16" } }))).error?.code).toBe("22023");
    expect((await alice.rpc("save_auto_plan", planArgs({ p_materials: { other: 1 } }))).error?.code).toBe("22023");
    const { data: f } = await admin.from("post_formats").insert({ project_id: bobProject, owner_id: bobId, name: "べつの型", body: "型 {穴}" }).select("id").single();
    expect((await alice.rpc("save_auto_plan", planArgs({ p_kind: "series", p_materials: { format_id: f!.id } }))).error?.code).toBe("22023");
    const { data: d } = await admin.from("project_destinations").insert({ project_id: bobProject, owner_id: bobId, kind: "site", label: "べつ", url: "https://example.com/" }).select("id").single();
    expect((await alice.rpc("save_auto_plan", planArgs({ p_kind: "product", p_materials: { destination_ids: [d!.id] } }))).error?.code).toBe("22023");
  });

  it("直すと、まだ作っていない回を消す（新しい規則で作り直す）", async () => {
    const id = await newPlan();
    await admin.from("auto_runs").insert({ plan_id: id, owner_id: aliceId, project_id: planProject.get(id)!, due_at: later(48), generate_at: later(24) });
    expect((await alice.rpc("save_auto_plan", planArgs({ p_plan_id: id, p_project_id: planProject.get(id), p_name: "直した" }))).error).toBeNull();
    expect((await admin.from("auto_runs").select("id").eq("plan_id", id)).data).toHaveLength(0);
    expect((await alice.rpc("save_auto_plan", planArgs({ p_plan_id: randomUUID() }))).error?.code).toBe("P0002");
  });

  it("1 プロジェクト 10 件まで（同時に作っても超えない）", async () => {
    const { data: p } = await alice.from("projects").insert({ name: "上限" }).select("id").single();
    const results = await Promise.all(Array.from({ length: 12 }, () => alice.rpc("save_auto_plan", planArgs({ p_project_id: p!.id }))));
    expect(results.filter((r) => !r.error)).toHaveLength(10);
    expect(results.filter((r) => r.error?.hint === "auto_plans_limit")).toHaveLength(2);
  });
});

describe("他人から読めない", () => {
  it("bob とログインしていない人は、alice の回し方・回・承認・予定を読めない", async () => {
    const id = await newPlan();
    const { targets } = await runWithPost(id);
    await admin.from("post_target_approvals").insert({ post_target_id: targets.x, owner_id: aliceId, fingerprint: "0".repeat(64) });
    expect((await alice.from("project_events").insert({ project_id: projectId, on_date: "2026-12-01", body: "冬の新メニュー" })).error).toBeNull();
    for (const table of ["auto_plans", "auto_runs", "post_target_approvals", "project_events"] as const) {
      expect((await alice.from(table).select("owner_id").eq("owner_id", aliceId)).data!.length).toBeGreaterThan(0);
      expect((await bob.from(table).select("owner_id").eq("owner_id", aliceId)).data).toEqual([]);
      expect((await anonClient().from(table).select("*").limit(1)).error?.code).toBe("42501");
    }
    // 送る中身と指紋: 本人は読める。他人は 0 行。未ログイン（anon）とサーバー（service_role）は呼べない（auth.uid() が null の道を開けない）
    const { postId } = await runWithPost(id);
    expect((await alice.rpc("auto_target_previews", { p_post_id: postId })).data).toHaveLength(2);
    expect((await bob.rpc("auto_target_previews", { p_post_id: postId })).data).toEqual([]);
    expect((await anonClient().rpc("auto_target_previews", { p_post_id: postId })).error?.code).toBe("42501");
    expect((await admin.rpc("auto_target_previews", { p_post_id: postId })).error?.code).toBe("42501");
  });

  it("利用者は回・承認を書けない。投稿の auto_run_id も書けない", async () => {
    const id = await newPlan();
    const { runId, postId, targets } = await runWithPost(id);
    expect((await alice.from("auto_runs").update({ status: "canceled" }).eq("id", runId)).error?.code).toBe("42501");
    expect((await alice.from("post_target_approvals").insert({ post_target_id: targets.x, owner_id: aliceId, fingerprint: "0".repeat(64) })).error?.code).toBe("42501");
    expect((await alice.from("posts").update({ auto_run_id: null }).eq("id", postId)).error?.code).toBe("42501");
    expect((await alice.from("posts").insert({ project_id: projectId, body: "手で", status: "draft", auto_run_id: runId })).error?.code).toBe("42501");
    // ほかの列はいままでどおり直せる
    expect((await alice.from("posts").update({ body: "直した" }).eq("id", postId)).error).toBeNull();
  });
});

describe("お知らせ・季節の予定（project_events）", () => {
  it("本人のプロジェクトにだけ足せる。持ち主は書き換えられない。1 プロジェクト 50 件まで", async () => {
    expect((await bob.from("project_events").insert({ project_id: projectId, on_date: "2026-12-01", body: "入れない" })).error).not.toBeNull();
    const { data: p } = await alice.from("projects").insert({ name: "予定" }).select("id").single();
    const { data: e } = await alice.from("project_events").insert({ project_id: p!.id, on_date: "2026-12-01", body: "冬" }).select("id").single();
    expect((await alice.from("project_events").update({ owner_id: bobId }).eq("id", e!.id)).error?.code).toBe("42501");
    expect((await alice.from("project_events").insert({ project_id: p!.id, on_date: "2026-12-01", body: " " })).error).not.toBeNull();
    const rows = Array.from({ length: 49 }, (_, i) => ({ project_id: p!.id, on_date: "2026-12-02", body: `予定 ${i}` }));
    expect((await alice.from("project_events").insert(rows)).error).toBeNull();
    expect((await alice.from("project_events").insert({ project_id: p!.id, on_date: "2026-12-03", body: "51 件目" })).error?.hint).toBe("project_events_limit");
  });
});

describe("確かめて送る（承認）", () => {
  it("承認の前は送信ジョブが取り出さない。見せた指紋で承認すると pending に戻り、記録が残る", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id, { dueAt: later(1) });
    // 時刻を過ぎた形にして取り出してみても、確かめ待ちは取り出されない
    await admin.from("posts").update({ planned_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", postId);
    const claimed = await admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: postId });
    expect(claimed.data!.map((c) => c.sns)).toEqual(["threads"]);
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    await admin.from("posts").update({ planned_at: later(1) }).eq("id", postId);

    const pv = await previews(postId);
    expect(pv.x.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: "f".repeat(64) })).error?.hint).toBe("content_changed");
    expect((await bob.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint })).error?.code).toBe("P0002");
    expect((await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint })).error).toBeNull();
    expect(await statusOf(targets.x)).toBe("pending");
    expect((await alice.from("post_target_approvals").select("fingerprint").eq("post_target_id", targets.x).single()).data!.fingerprint).toBe(pv.x.fingerprint);
  });

  it("承認のあとに文を変えたら、承認を外して確かめ待ちに戻す（共通の本文・SNS ごとの文・タグ）", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id);
    const approve = async () => {
      const pv = await previews(postId);
      expect((await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint })).error).toBeNull();
    };
    await approve();
    await alice.from("posts").update({ body: "あとから直した本文" }).eq("id", postId);
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    expect((await admin.from("post_target_approvals").select("post_target_id").eq("post_target_id", targets.x)).data).toEqual([]);
    await approve();
    await alice.from("post_targets").update({ hashtags: ["パン"] }).eq("id", targets.x);
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    await approve();
    // ほかの SNS の文だけ変えたときは、X の承認はそのまま
    await alice.from("post_targets").update({ body_override: "Threads だけの文" }).eq("id", targets.threads);
    expect(await statusOf(targets.x)).toBe("pending");
  });

  it("送る時刻を過ぎたら承認できない", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id);
    const pv = await previews(postId);
    await admin.from("posts").update({ planned_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", postId);
    expect((await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint })).error?.hint).toBe("approval_expired");
  });

  it("送らない（decline）はその配信先を外す。1 つも残らなければ投稿を下書きに戻す", async () => {
    const id = await newPlan();
    const one = await runWithPost(id);
    expect((await alice.rpc("decline_auto_target", { p_target_id: one.targets.x })).error).toBeNull();
    expect(await statusOf(one.targets.x)).toBeUndefined();
    expect((await admin.from("posts").select("status").eq("id", one.postId).single()).data!.status).toBe("scheduled");
    const only = await runWithPost(id, { targets: [["x", "awaiting_approval"]] });
    expect((await alice.rpc("decline_auto_target", { p_target_id: only.targets.x })).error).toBeNull();
    expect((await admin.from("posts").select("status").eq("id", only.postId).single()).data!.status).toBe("draft");
    expect((await alice.rpc("decline_auto_target", { p_target_id: one.targets.threads })).error?.code).toBe("P0002");
  });

  it("save_post で直す・外すときも、確かめ待ちの配信先を送る前のものとして扱う（状態は変えない）", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id);
    const save = (t: { sns: string; body_override?: string }[]) => alice.rpc("save_post", { p_post_id: postId, p_project_id: planProject.get(id)!, p_body: "直した", p_planned_at: later(24), p_status: "scheduled", p_targets: t });
    expect((await save([{ sns: "threads" }, { sns: "x", body_override: "X の文" }])).error).toBeNull();
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    expect((await admin.from("post_targets").select("body_override").eq("id", targets.x).single()).data!.body_override).toBe("X の文");
    expect((await save([{ sns: "threads" }])).error).toBeNull();
    expect(await statusOf(targets.x)).toBeUndefined();
  });
});

describe("最初の回の確かめ（review_auto_run。A3）", () => {
  it("送るなら、確かめ待ちの SNS もまとめて承認し、投稿を予約にして、次の回から確かめない", async () => {
    const id = await newPlan();
    const { runId, postId, targets } = await runWithPost(id, { status: "review", postStatus: "draft" });
    const pv = await previews(postId);
    expect((await alice.rpc("review_auto_run", { p_run_id: runId, p_send: true, p_fingerprints: { [targets.x]: "0".repeat(64) } })).error?.hint).toBe("content_changed");
    expect((await alice.rpc("review_auto_run", { p_run_id: runId, p_send: true, p_fingerprints: { [targets.x]: pv.x.fingerprint } })).error).toBeNull();
    expect(await statusOf(targets.x)).toBe("pending");
    expect((await admin.from("posts").select("status").eq("id", postId).single()).data!.status).toBe("scheduled");
    expect((await admin.from("auto_runs").select("status").eq("id", runId).single()).data!.status).toBe("scheduled");
    expect((await admin.from("auto_plans").select("first_review").eq("id", id).single()).data!.first_review).toBe(false);
  });

  it("送らないなら、その回は取り消し、投稿は下書きのまま。ほかの人の回は扱えない", async () => {
    const id = await newPlan();
    const { runId, postId } = await runWithPost(id, { status: "review", postStatus: "draft" });
    expect((await bob.rpc("review_auto_run", { p_run_id: runId, p_send: false })).error?.code).toBe("P0002");
    expect((await alice.rpc("review_auto_run", { p_run_id: runId, p_send: false })).error).toBeNull();
    expect((await admin.from("auto_runs").select("status, reason").eq("id", runId).single()).data).toEqual({ status: "canceled", reason: "user_skipped" });
    expect((await admin.from("posts").select("status").eq("id", postId).single()).data!.status).toBe("draft");
    expect((await admin.from("auto_plans").select("first_review").eq("id", id).single()).data!.first_review).toBe(true);
  });
});

describe("止める・飛ばす・消す", () => {
  it("止めると、まだ作っていない回と作り終えた予約を止め、投稿を下書きに戻す。再開で作り直せる", async () => {
    const id = await newPlan();
    const { data: waiting } = await admin.from("auto_runs").insert({ plan_id: id, owner_id: aliceId, project_id: planProject.get(id)!, due_at: later(72), generate_at: later(48) }).select("id").single();
    const made = await runWithPost(id);
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: planProject.get(id)!, p_plan_id: id, p_status: "paused", p_to_draft: true })).error).toBeNull();
    expect((await admin.from("auto_plans").select("status").eq("id", id).single()).data!.status).toBe("paused");
    expect((await admin.from("auto_runs").select("status").eq("id", made.runId).single()).data!.status).toBe("canceled");
    expect((await admin.from("posts").select("status").eq("id", made.postId).single()).data!.status).toBe("draft");
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: planProject.get(id)!, p_plan_id: id, p_status: "active" })).error).toBeNull();
    expect((await admin.from("auto_runs").select("id").eq("id", waiting!.id)).data).toEqual([]);
    expect((await admin.from("auto_runs").select("id").eq("id", made.runId)).data).toHaveLength(1);
  });

  it("止めるときに「そのまま送る」を選ぶと、作り終えた予約は残す。送り始めた投稿は下書きに戻さない", async () => {
    const id = await newPlan();
    const keep = await runWithPost(id);
    const sent = await runWithPost(id, { dueAt: later(30), targets: [["threads", "published"], ["x", "awaiting_approval"]] });
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: planProject.get(id)!, p_plan_id: id, p_status: "paused", p_to_draft: false })).error).toBeNull();
    expect((await admin.from("posts").select("status").eq("id", keep.postId).single()).data!.status).toBe("scheduled");
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: planProject.get(id)!, p_plan_id: id, p_status: "paused", p_to_draft: true })).error).toBeNull();
    expect((await admin.from("posts").select("status").eq("id", sent.postId).single()).data!.status).toBe("scheduled");
  });

  it("全部止める（p_plan_id なし）は止めるだけ。ほかの人の回し方は止められない", async () => {
    const { data: p } = await alice.from("projects").insert({ name: "全部" }).select("id").single();
    await newPlan(alice, { p_project_id: p!.id });
    await newPlan(alice, { p_project_id: p!.id });
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: p!.id, p_plan_id: null as unknown as string, p_status: "active" })).error?.code).toBe("22023");
    expect((await bob.rpc("set_auto_plan_status", { p_project_id: p!.id, p_plan_id: null as unknown as string, p_status: "paused" })).data).toBe(0);
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: p!.id, p_plan_id: null as unknown as string, p_status: "paused" })).data).toBe(2);
    expect((await admin.from("auto_plans").select("status").eq("project_id", p!.id)).data!.every((r) => r.status === "paused")).toBe(true);
  });

  it("次の回を飛ばす。消すと、まだ送っていない予約を下書きに戻す", async () => {
    const id = await newPlan();
    const first = await runWithPost(id, { dueAt: later(5) });
    const second = await runWithPost(id, { dueAt: later(50) });
    const { data } = await alice.rpc("skip_next_auto_run", { p_plan_id: id });
    expect(new Date(data as string).getTime()).toBe(new Date((await admin.from("auto_runs").select("due_at").eq("id", first.runId).single()).data!.due_at).getTime());
    expect((await admin.from("posts").select("status").eq("id", first.postId).single()).data!.status).toBe("draft");
    expect((await bob.rpc("delete_auto_plan", { p_plan_id: id })).error?.code).toBe("P0002");
    expect((await alice.rpc("delete_auto_plan", { p_plan_id: id, p_to_draft: true })).error).toBeNull();
    expect((await admin.from("posts").select("status, auto_run_id").eq("id", second.postId).single()).data).toEqual({ status: "draft", auto_run_id: null });
    expect((await alice.rpc("skip_next_auto_run", { p_plan_id: id })).error?.code).toBe("P0002");
  });
});

describe("セキュリティ確認（2026-11-17）", () => {
  it("M1: 運営者が止めた回し方は、利用者が再開も一時停止もできない。ほかの理由で止まったものは再開できる", async () => {
    // 運営者が止めた回し方があるプロジェクトは作る・直すもできなくなるので、ほかのテストと分けたプロジェクトで試す
    const project = (await alice.from("projects").insert({ name: "運営者が止めた" }).select("id").single()).data!.id;
    const op = await newPlan(alice, { p_project_id: project });
    await admin.from("auto_plans").update({ status: "stopped", stop_reason: "operator" }).eq("id", op);
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: project, p_plan_id: op, p_status: "active" })).error?.code).toBe("42501");
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: project, p_plan_id: op, p_status: "paused" })).error?.code).toBe("42501");
    // 全部止めるは、運営者が止めたものを飛ばす（止まったまま）
    expect((await alice.rpc("set_auto_plan_status", { p_project_id: project, p_plan_id: null as unknown as string, p_status: "paused" })).error).toBeNull();
    expect((await admin.from("auto_plans").select("status, stop_reason").eq("id", op).single()).data).toEqual({ status: "stopped", stop_reason: "operator" });

    for (const reason of ["fail_streak", "disconnected", "materials_out"]) {
      const id = await newPlan();
      await admin.from("auto_plans").update({ status: "stopped", stop_reason: reason }).eq("id", id);
      expect((await alice.rpc("set_auto_plan_status", { p_project_id: planProject.get(id)!, p_plan_id: id, p_status: "active" })).error).toBeNull();
      expect((await admin.from("auto_plans").select("status").eq("id", id).single()).data!.status).toBe("active");
    }
  });

  it("R4: 運営者が止めた回し方は消せない。同じプロジェクトでは作る・直すもできない。ほかのプロジェクトは今までどおり", async () => {
    const project = (await alice.from("projects").insert({ name: "運営者が止めた R4" }).select("id").single()).data!.id;
    const op = await newPlan(alice, { p_project_id: project });
    const other = await newPlan(alice, { p_project_id: project });
    await admin.from("auto_plans").update({ status: "stopped", stop_reason: "operator" }).eq("id", op);

    const del = await alice.rpc("delete_auto_plan", { p_plan_id: op, p_to_draft: true });
    expect(del.error?.code).toBe("42501");
    expect(del.error?.hint).toBe("auto_plan_operator_stop");
    expect((await admin.from("auto_plans").select("stop_reason").eq("id", op).single()).data!.stop_reason).toBe("operator");
    // 作る・直す（止めた回し方も、同じプロジェクトのほかの回し方も）
    expect((await alice.rpc("save_auto_plan", planArgs({ p_project_id: project }))).error?.hint).toBe("auto_plan_operator_stop");
    expect((await alice.rpc("save_auto_plan", planArgs({ p_project_id: project, p_plan_id: op }))).error?.code).toBe("42501");
    expect((await alice.rpc("save_auto_plan", planArgs({ p_project_id: project, p_plan_id: other, p_name: "直す" }))).error?.code).toBe("42501");
    // 同じプロジェクトのほかの回し方を消すのはよい（止める方向なので）
    expect((await alice.rpc("delete_auto_plan", { p_plan_id: other, p_to_draft: true })).error).toBeNull();
    // ほかのプロジェクトでは、今までどおり作れる・消せる
    const elsewhere = await newPlan();
    expect((await alice.rpc("delete_auto_plan", { p_plan_id: elsewhere, p_to_draft: true })).error).toBeNull();
    // ほかの理由で止まった回し方は、今までどおり消せる
    const failed = await newPlan();
    await admin.from("auto_plans").update({ status: "stopped", stop_reason: "fail_streak" }).eq("id", failed);
    expect((await alice.rpc("delete_auto_plan", { p_plan_id: failed, p_to_draft: true })).error).toBeNull();
  });

  it("L1: 自動で作った印は利用者が書けない。auto_run_id を付けると印も付き、回し方を消しても残る", async () => {
    const id = await newPlan();
    const { postId } = await runWithPost(id);
    expect((await admin.from("posts").select("auto_created").eq("id", postId).single()).data!.auto_created).toBe(true);
    expect((await alice.from("posts").update({ auto_created: false }).eq("id", postId)).error?.code).toBe("42501");
    expect((await alice.from("posts").insert({ project_id: projectId, body: "手で", status: "draft", auto_created: true })).error?.code).toBe("42501");
    expect((await alice.rpc("delete_auto_plan", { p_plan_id: id, p_to_draft: true })).error).toBeNull();
    expect((await admin.from("posts").select("auto_run_id, auto_created").eq("id", postId).single()).data).toEqual({ auto_run_id: null, auto_created: true });
    // サーバーも、一度付いた印は外せない
    await admin.from("posts").update({ auto_created: false }).eq("id", postId);
    expect((await admin.from("posts").select("auto_created").eq("id", postId).single()).data!.auto_created).toBe(true);
  });

  it("L1 ①: 確かめ待ちの配信先を外して付け直しても（直接・save_post）、確かめ待ちのまま。手で作った投稿は今までどおり", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id);
    const project = planProject.get(id)!;
    expect((await alice.from("post_targets").delete().eq("id", targets.x)).error).toBeNull();
    const { data: direct, error } = await alice.from("post_targets").insert({ post_id: postId, sns: "x" }).select("id, status").single();
    expect(error).toBeNull();
    expect(direct!.status).toBe("awaiting_approval");
    // save_post で外して、付け直す
    const body = (await admin.from("posts").select("body").eq("id", postId).single()).data!.body;
    const save = (targetsArg: unknown[]) =>
      alice.rpc("save_post", { p_post_id: postId, p_project_id: project, p_body: body, p_planned_at: later(24), p_status: "scheduled", p_targets: targetsArg as never });
    expect((await save([{ sns: "threads" }])).error).toBeNull();
    expect((await admin.from("post_targets").select("id").eq("post_id", postId).eq("sns", "x")).data).toEqual([]);
    expect((await save([{ sns: "threads" }, { sns: "x" }])).error).toBeNull();
    expect((await admin.from("post_targets").select("status").eq("post_id", postId).eq("sns", "x").single()).data!.status).toBe("awaiting_approval");
    expect((await admin.from("post_targets").select("status").eq("post_id", postId).eq("sns", "threads").single()).data!.status).toBe("pending");

    // トリガーは security invoker（current_user で利用者かを見るため）。ほかの人の投稿に足そうとすると、トリガーより先に post_targets の insert のポリシーで断られる
    expect((await bob.from("post_targets").insert({ post_id: postId, sns: "tiktok" })).error?.code).toBe("42501");
    expect((await admin.from("post_targets").select("id").eq("post_id", postId).eq("sns", "tiktok")).data).toEqual([]);

    const { data: manual } = await alice.from("posts").insert({ project_id: projectId, body: "手で書いた", status: "draft" }).select("id").single();
    const { data: mt } = await alice.from("post_targets").insert({ post_id: manual!.id, sns: "x" }).select("status").single();
    expect(mt!.status).toBe("pending");
  });

  it("L1 ②: 回し方を消したあとに送り直しても、承認の記録がなければ確かめ待ちに戻る", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id, { targets: [["threads", "failed"], ["x", "failed"]] });
    expect((await alice.rpc("delete_auto_plan", { p_plan_id: id, p_to_draft: false })).error).toBeNull();
    expect((await alice.rpc("requeue_failed_targets", { p_post_id: postId, p_sns: ["threads", "x"] })).error).toBeNull();
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    expect(await statusOf(targets.threads)).toBe("pending");
  });

  it("L1: 送信ジョブは、自動で作った投稿の X を、いまの中身への承認がなければ取り出さない", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id, { targets: [["x", "pending"]] });
    await admin.from("posts").update({ planned_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", postId);
    expect((await admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: postId })).data).toEqual([]);
    // 古い指紋の承認も数えない
    await admin.from("post_target_approvals").insert({ post_target_id: targets.x, owner_id: aliceId, fingerprint: "0".repeat(64) });
    expect((await admin.rpc("claim_due_targets", { p_limit: 10, p_post_id: postId })).data).toEqual([]);
    // 黙って飛ばさずに、確かめ待ちに戻す（2026-11-18 の確認の L1。tests/auto-approval-fixes.integration.test.ts）
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
  });

  it("承認の指紋には、送り先のアカウント・引用する投稿・添えた画像も入る。承認のあとに変えたら確かめ待ちに戻る", async () => {
    const id = await newPlan();
    const { postId, targets } = await runWithPost(id);
    const approve = async () => {
      const pv = await previews(postId);
      expect((await alice.rpc("approve_auto_target", { p_target_id: targets.x, p_fingerprint: pv.x.fingerprint })).error).toBeNull();
      expect(await statusOf(targets.x)).toBe("pending");
    };
    await approve();
    await alice.from("post_targets").update({ quote_post_id: "1234567890" }).eq("id", targets.x);
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    await approve();
    const { data: m, error } = await admin
      .from("media_files")
      .insert({ owner_id: aliceId, post_id: postId, storage_path: `${aliceId}/${randomUUID()}.jpg`, width: 10, height: 10, size_bytes: 100 })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
    await approve();
    await admin.from("media_files").delete().eq("id", m!.id);
    expect(await statusOf(targets.x)).toBe("awaiting_approval");
  });
});

describe("作る回の取り出し（claim_due_auto_runs）", () => {
  it("作る時刻が来た回だけを、同時に呼んでも 1 回だけ取り出す。止めた回し方・送る時刻を過ぎた回は取り出さない。利用者は呼べない", async () => {
    const id = await newPlan();
    const paused = await newPlan();
    await alice.rpc("set_auto_plan_status", { p_project_id: planProject.get(paused)!, p_plan_id: paused, p_status: "paused" });
    const past = new Date(Date.now() - 60_000).toISOString();
    const { data: due } = await admin
      .from("auto_runs")
      .insert([1, 2, 3].map((h) => ({ plan_id: id, owner_id: aliceId, project_id: planProject.get(id)!, due_at: later(h), generate_at: past })))
      .select("id");
    await admin.from("auto_runs").insert([
      { plan_id: id, owner_id: aliceId, project_id: planProject.get(id)!, due_at: later(30), generate_at: later(6) },
      { plan_id: id, owner_id: aliceId, project_id: planProject.get(id)!, due_at: past, generate_at: past },
      { plan_id: paused, owner_id: aliceId, project_id: planProject.get(paused)!, due_at: later(2), generate_at: past },
    ]);
    const results = await Promise.all(Array.from({ length: 5 }, () => admin.rpc("claim_due_auto_runs", { p_limit: 25 })));
    const mine = results.flatMap((r) => r.data ?? []).filter((r) => r.owner_id === aliceId).map((r) => r.id);
    expect(mine.sort()).toEqual(due!.map((r) => r.id).sort());
    expect((await admin.from("auto_runs").select("status, attempts").in("id", mine)).data!.every((r) => r.status === "generating" && r.attempts === 1)).toBe(true);
    expect((await alice.rpc("claim_due_auto_runs", { p_limit: 5 })).error?.code).toBe("42501");
    // 作っている途中で 10 分たったものは、もう一度取り出す。3 回目のあとは飛ばす
    await admin.from("auto_runs").update({ locked_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq("id", mine[0]);
    expect((await admin.rpc("claim_due_auto_runs", { p_limit: 25 })).data!.map((r) => r.id)).toContain(mine[0]);
    await admin.from("auto_runs").update({ locked_at: new Date(Date.now() - 11 * 60_000).toISOString(), attempts: 3 }).eq("id", mine[0]);
    await admin.rpc("claim_due_auto_runs", { p_limit: 25 });
    expect((await admin.from("auto_runs").select("status, reason").eq("id", mine[0]).single()).data).toEqual({ status: "skipped", reason: "error" });
  });
});
