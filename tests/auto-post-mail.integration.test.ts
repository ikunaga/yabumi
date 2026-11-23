// 自動投稿の知らせのメール（src/lib/auto-post/mail.ts・20261123120000_auto_post_mail。2026-11-23 オーナーの指示「メールでも送れるようにして」）。
// 1 人 1 通にまとめる・二重に送らない・送れなかったら次にまた送る・送る時刻を過ぎた回は送らない・受け取らない人には送らない・運営者の止めた／解除した、
// 設定の列（auto_post_email）は本人だけが変えられる・notification_log の check・ワンクリックで止まるのは自動投稿のメールだけ。
// メールは偽の送り先（fetch を差し替え）で、本物の Resend には送らない。テストの行はこのファイルの利用者だけに作り、最後に 0 件を確かめる
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// ワンクリックの止め方（unsubscribeByToken）は、サーバーの権限の部品をテストの管理者の client に差し替えて通す
vi.mock("@/lib/supabase/admin", async () => ({ createAdminClient: (await import("./helpers/supabase")).adminClient }));
import { mailAutoNotices } from "@/lib/auto-post/mail";
import { unsubscribeByToken } from "@/lib/coach/unsubscribe";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const HOUR = 3_600_000;
const later = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const sent: { to: string[]; subject: string; text: string; headers?: Record<string, string> }[] = [];
let status = 200;
const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
  if (status === 200) sent.push(JSON.parse(String(init?.body)));
  return new Response("{}", { status });
});
const deps = { mail: { apiKey: "test-key", fetch: fakeFetch as unknown as typeof fetch }, appUrl: "https://yabumi.example" };
const run = () => mailAutoNotices(admin, new Date(), deps, { ownerIds: [aliceId] });

async function newPlan(name = "毎朝のパン"): Promise<string> {
  const { data, error } = await alice.rpc("save_auto_plan", {
    p_plan_id: null as unknown as string,
    p_project_id: projectId,
    p_name: name,
    p_kind: "notes",
    p_materials: { note_order: "old_first" },
    p_targets: { threads: "auto", x: "review" },
    p_x_link: "never",
    p_schedule: { weekdays: [2, 5], time: "19:00", every_weeks: 1, start: "2026-11-16" },
    p_instructions: [],
    p_lead_hours: 24,
    p_consent: true,
  });
  if (error) throw error;
  return data as string;
}
const BODY = `投稿の本文 ${randomUUID()}`;
// 自動の回と、その投稿（サーバーが作るのと同じ形）
async function runWithPost(planId: string, opts: { status: string; dueAt: string; targets: [string, string][] }) {
  const { data: r, error } = await admin
    .from("auto_runs")
    .insert({ plan_id: planId, owner_id: aliceId, project_id: projectId, due_at: opts.dueAt, generate_at: new Date().toISOString(), status: opts.status })
    .select("id")
    .single();
  if (error) throw error;
  const { data: post, error: e2 } = await admin
    .from("posts")
    .insert({ project_id: projectId, owner_id: aliceId, body: BODY, status: opts.status === "held" ? "draft" : "scheduled", planned_at: opts.dueAt, text_origin: "ai", auto_run_id: r.id })
    .select("id")
    .single();
  if (e2) throw e2;
  await admin.from("auto_runs").update({ post_id: post.id }).eq("id", r.id);
  for (const [sns, s] of opts.targets) {
    const { error: e3 } = await admin.from("post_targets").insert({ post_id: post.id, owner_id: aliceId, sns, status: s });
    if (e3) throw e3;
  }
  return r.id;
}
const logs = async () => (await admin.from("notification_log").select("kind, period_key, project_id").eq("user_id", aliceId).eq("channel", "email")).data ?? [];

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  const { error } = await admin.from("legal_consents").insert({ user_id: aliceId, version: "2026-11-16", via: "signup" });
  if (error) throw error;
});

beforeEach(async () => {
  projectId = (await alice.from("projects").insert({ name: "パン屋" }).select("id").single()).data!.id;
});

afterEach(async () => {
  sent.length = 0;
  status = 200;
  fakeFetch.mockClear();
  await admin.from("notification_log").delete().eq("user_id", aliceId);
  await admin.from("auto_post_holds").delete().eq("user_id", aliceId);
  await admin.from("notification_prefs").delete().in("user_id", [aliceId, bobId]);
  await admin.from("projects").delete().eq("owner_id", aliceId);
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
  for (const table of ["auto_plans", "auto_runs"] as const) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
    expect(count).toBe(0);
  }
  const { count } = await admin.from("notification_log").select("*", { count: "exact", head: true }).in("user_id", [aliceId, bobId]);
  expect(count).toBe(0);
});

describe("まとめて送る・二重に送らない", () => {
  it("下書き・1 回目の確認待ち・2 時間前の確認待ち・止めた回し方を 1 通にまとめる。投稿の本文は入れない。2 回目は送らない", async () => {
    const plan = await newPlan();
    await runWithPost(plan, { status: "held", dueAt: later(30), targets: [["threads", "pending"]] });
    await runWithPost(plan, { status: "review", dueAt: later(26), targets: [["threads", "pending"], ["x", "awaiting_approval"]] });
    await runWithPost(plan, { status: "scheduled", dueAt: later(1), targets: [["threads", "pending"], ["x", "awaiting_approval"]] });
    // 予約しただけの回（確認待ちなし）は送らない
    await runWithPost(plan, { status: "scheduled", dueAt: later(1.5), targets: [["threads", "pending"]] });
    const stopped = await newPlan("季節のあいさつ");
    await admin.from("auto_plans").update({ status: "stopped", stop_reason: "disconnected", updated_at: new Date().toISOString() }).eq("id", stopped);

    expect(await run()).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    const { data: u } = await admin.auth.admin.getUserById(aliceId);
    expect(m.to).toEqual([u.user!.email]);
    expect(m.subject).toBe("yabumi: 自動投稿が止まっています");
    expect(m.text).toContain("・「季節のあいさつ」: SNS のつながりが切れています。SNS をつなぎ直してから、再開してください。");
    expect(m.text).toMatch(/・「毎朝のパン」.* に X・Threads に送る 1 回目の投稿です。/);
    expect(m.text).toMatch(/・「毎朝のパン」.* に X に送る投稿を、まだ確認していません。/);
    expect(m.text).toMatch(/・「毎朝のパン」.* の投稿は、送らずに下書きに残しました。/);
    expect(m.text.match(/まだ確認していません/g)).toHaveLength(1);
    expect(m.text).toContain(`確認する: https://yabumi.example/projects/${projectId}/auto`);
    expect(m.text).not.toContain(BODY);
    expect(m.headers?.["List-Unsubscribe"]).toMatch(/&k=auto>$/);
    expect((await logs()).map((l) => l.kind).sort()).toEqual(["auto_held", "auto_remind", "auto_review", "auto_stop"]);

    expect(await run()).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("送れなかったら記録を消し、次のジョブでまた送る", async () => {
    const plan = await newPlan();
    await runWithPost(plan, { status: "held", dueAt: later(30), targets: [["threads", "pending"]] });
    status = 500;
    expect(await run()).toEqual({ sent: 0, failed: 1 });
    expect(await logs()).toEqual([]);
    status = 200;
    expect(await run()).toEqual({ sent: 1, failed: 0 });
    expect(sent[0].subject).toBe("yabumi: 自動投稿を送らずに下書きに残しました");
  });

  it("送る時刻を過ぎた回は送らない", async () => {
    const plan = await newPlan();
    await runWithPost(plan, { status: "held", dueAt: later(-1), targets: [["threads", "pending"]] });
    await runWithPost(plan, { status: "review", dueAt: later(-0.5), targets: [["threads", "pending"]] });
    expect(await run()).toEqual({ sent: 0, failed: 0 });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("メールで受け取らない人には、どれも送らない（運営者が止めた知らせも）", async () => {
    await alice.from("notification_prefs").insert({ user_id: aliceId, auto_post_email: false });
    const plan = await newPlan();
    await runWithPost(plan, { status: "held", dueAt: later(30), targets: [["threads", "pending"]] });
    await admin.from("auto_post_holds").insert({ user_id: aliceId, reason: "テスト", held_by: "test" });
    expect(await run()).toEqual({ sent: 0, failed: 0 });
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(await logs()).toEqual([]);
  });
});

describe("運営者が止めた・解除した", () => {
  it("止めた知らせを 1 回、解除したら解除の知らせを 1 回。理由は入れない", async () => {
    const { data: h } = await admin.from("auto_post_holds").insert({ user_id: aliceId, reason: "ひみつの理由", held_by: "test" }).select("id").single();
    expect(await run()).toEqual({ sent: 1, failed: 0 });
    expect(sent[0].subject).toBe("yabumi: 自動投稿が止まっています");
    expect(sent[0].text).not.toContain("ひみつの理由");
    expect(await logs()).toEqual([{ kind: "auto_hold", period_key: h!.id, project_id: null }]);
    expect(await run()).toEqual({ sent: 0, failed: 0 });
    await admin.from("auto_post_holds").update({ released_at: new Date().toISOString(), released_by: "test", release_reason: "テスト" }).eq("id", h!.id);
    expect(await run()).toEqual({ sent: 1, failed: 0 });
    expect(sent[1].subject).toBe("yabumi: 自動投稿をまた使えるようになりました");
  });

  it("止めた知らせを送る前に解除したときは、解除の知らせも送らない", async () => {
    await admin.from("auto_post_holds").insert({ user_id: aliceId, reason: "テスト", held_by: "test", released_at: new Date().toISOString(), released_by: "test", release_reason: "テスト" });
    expect(await run()).toEqual({ sent: 0, failed: 0 });
  });
});

describe("設定と記録の権限", () => {
  it("auto_post_email は本人だけが変えられる（ほかの人・未ログインは変えられない）", async () => {
    expect((await alice.from("notification_prefs").insert({ user_id: aliceId, auto_post_email: false })).error).toBeNull();
    expect((await bob.from("notification_prefs").insert({ user_id: bobId })).error).toBeNull();
    // ほかの人の行は、RLS で見えないので変わらない
    await bob.from("notification_prefs").update({ auto_post_email: true }).eq("user_id", aliceId);
    await anonClient().from("notification_prefs").update({ auto_post_email: true }).eq("user_id", aliceId);
    expect((await admin.from("notification_prefs").select("auto_post_email").eq("user_id", aliceId).single()).data!.auto_post_email).toBe(false);
    expect((await bob.from("notification_prefs").insert({ user_id: aliceId, auto_post_email: true })).error).not.toBeNull();
    // 本人は変えられる
    expect((await alice.from("notification_prefs").update({ auto_post_email: true }).eq("user_id", aliceId)).error).toBeNull();
    expect((await admin.from("notification_prefs").select("auto_post_email").eq("user_id", aliceId).single()).data!.auto_post_email).toBe(true);
  });

  it("notification_log: 利用者は読めない。project_id が空でよいのは運営者の止めた・解除しただけ。空どうしも二重に入らない", async () => {
    expect((await admin.from("notification_log").insert({ user_id: aliceId, project_id: null, kind: "weekly", period_key: "2026-W48", channel: "email" })).error?.code).toBe("23514");
    expect((await admin.from("notification_log").insert({ user_id: aliceId, project_id: null, kind: "auto_held", period_key: randomUUID(), channel: "email" })).error?.code).toBe("23514");
    const key = randomUUID();
    expect((await admin.from("notification_log").insert({ user_id: aliceId, project_id: null, kind: "auto_hold", period_key: key, channel: "email" })).error).toBeNull();
    expect((await admin.from("notification_log").insert({ user_id: aliceId, project_id: null, kind: "auto_hold", period_key: key, channel: "email" })).error?.code).toBe("23505");
    expect((await admin.from("notification_log").insert({ user_id: aliceId, project_id: projectId, kind: "unknown", period_key: key, channel: "email" })).error?.code).toBe("23514");
    const read = await alice.from("notification_log").select("id");
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
    expect((await alice.from("notification_log").insert({ user_id: aliceId, project_id: projectId, kind: "auto_held", period_key: key, channel: "email" })).error).not.toBeNull();
  });

  it("ワンクリック（k=auto）で止まるのは自動投稿のメールだけ（投稿のペースのお知らせのメールはそのまま）", async () => {
    const { data: prefs } = await admin.from("notification_prefs").upsert({ user_id: aliceId }).select("unsubscribe_token, email_mode").single();
    expect(await unsubscribeByToken(prefs!.unsubscribe_token, "auto")).toBe(true);
    const { data } = await admin.from("notification_prefs").select("auto_post_email, email_mode").eq("user_id", aliceId).single();
    expect(data).toEqual({ auto_post_email: false, email_mode: prefs!.email_mode });
    expect(await unsubscribeByToken(prefs!.unsubscribe_token)).toBe(true);
    expect((await admin.from("notification_prefs").select("email_mode").eq("user_id", aliceId).single()).data!.email_mode).toBe("off");
  });
});
