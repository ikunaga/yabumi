// 振り返りの相談を終えたら、振り返りのやることを済みにする（docs/architecture.md の 4.23）。
// やることから始めたときはそのやること（本人の今週・来週の振り返りのやることだけ結びつける）、分析の画面から始めたときは今週の振り返りのやることが 1 つだけのとき。
// AI は callModel をモックし、本物の Claude API は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeConsultThread, consultStep, REVIEW_ITEM_NOT_FOUND, type ConsultInput } from "@/lib/ai/consult";
import type { CallModel } from "@/lib/ai/plan-coach";
import { weekStartOf } from "@/lib/roadmap/schema";
import { addDays, toYmd } from "@/lib/time";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adminClient, deleteUser, signUpNewUser, type TestClient, goalLess } from "./helpers/supabase";

const admin = adminClient();
const usage = { inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 500 };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;

const thisWeek = weekStartOf(toYmd(new Date()));
const reply = (): CallModel => vi.fn(async () => ({ turn: { message: "この 1 週間は…", choices: [], proposal: null, wrap_up: null }, stopReason: "end_turn", model: "claude-opus-5-5", usage }));
const loadKpiValues = async () => ({});
const step = (projectId: string, input: ConsultInput, callModel = reply()) =>
  consultStep(alice, admin, { callModel, loadKpiValues, loadReview: async () => ({ kpiValues: {}, clicksBySns: [], topClicked: [], topViewed: [] }) }, { userId: aliceId, projectId, threadId: null, input });
const close = (projectId: string, threadId: string) => closeConsultThread(alice, admin, { userId: aliceId, projectId, threadId });

const newProject = async (client: TestClient, name = "季節の器") => (await client.from("projects").insert({ name, description: "器の店", target_audience: "30 代" }).select("id").single()).data!.id;
const addItem = async (client: TestClient, projectId: string, title: string, kind: string | null, weekStart = thisWeek) =>
  (await client.from("roadmap_items").insert(goalLess({ project_id: projectId, title, kind, week_start: weekStart })).select("id").single()).data!.id;
const statusOf = async (id: string) => (await admin.from("roadmap_items").select("status, done_at").eq("id", id).single()).data!;
const threadCount = async (projectId: string) => (await admin.from("ai_threads").select("id", { count: "exact", head: true }).eq("project_id", projectId)).count;

scopeAiBudget();

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("やることから始めた振り返り", () => {
  let projectId: string;
  let reviewId: string;

  beforeAll(async () => {
    projectId = await newProject(alice);
    reviewId = await addItem(alice, projectId, "4 週間の振り返り", "review");
  });

  it("他人のやること・ほかの週・振り返りでないやること・振り返り以外の相談には結びつけない（会話も作らず、AI も呼ばない）", async () => {
    const bobProject = await newProject(bob, "ほかの人の店");
    const bobItem = await addItem(bob, bobProject, "ほかの人の振り返り", "review");
    const later = await addItem(alice, projectId, "再来週の振り返り", "review", addDays(thisWeek, 14));
    const last = await addItem(alice, projectId, "先週の振り返り", "review", addDays(thisWeek, -7));
    const post = await addItem(alice, projectId, "1 本書く", "post");
    const callModel = reply();
    // 他人のやることは、自分のプロジェクトの id で名乗っても RLS で読めない
    for (const itemId of [bobItem, later, last, post, crypto.randomUUID()]) {
      expect(await step(projectId, { kind: "start", topic: "review", itemId }, callModel)).toEqual({ ok: false, threadId: null, message: REVIEW_ITEM_NOT_FOUND });
    }
    expect(await step(projectId, { kind: "start", topic: "what_to_post", itemId: reviewId }, callModel)).toEqual({ ok: false, threadId: null, message: REVIEW_ITEM_NOT_FOUND });
    expect(callModel).not.toHaveBeenCalled();
    expect(await threadCount(projectId)).toBe(0);
    expect((await statusOf(bobItem)).status).toBe("todo");
  });

  it("本人の今週の振り返りのやることを結びつけ、まとめなしで終えても済みにする（知らせ用に id を添える）", async () => {
    // 同じ週に振り返りのやることがもう 1 つあっても、結びつけたものだけ
    const other = await addItem(alice, projectId, "数字を見る", "review");
    const r = await step(projectId, { kind: "start", topic: "review", itemId: reviewId });
    expect(r.ok).toBe(true);
    const threadId = (r as { threadId: string }).threadId;
    const { data: first } = await admin.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "user").single();
    expect(first!.content).toEqual({ kind: "start", topic: "review", itemId: reviewId });

    expect(await close(projectId, threadId)).toEqual({ ok: true, redirect: `/projects/${projectId}/metrics?done=consult_closed&reviewed=${reviewId}` });
    expect(await statusOf(reviewId)).toMatchObject({ status: "done", done_at: expect.any(String) });
    expect((await statusOf(other)).status).toBe("todo");
  });

  it("来週の振り返りのやることも結びつけられる。もう済んでいたら変えず、知らせにも出さない", async () => {
    const next = await addItem(alice, projectId, "来週の振り返り", "review", addDays(thisWeek, 7));
    const r = await step(projectId, { kind: "start", topic: "review", itemId: next });
    const threadId = (r as { threadId: string }).threadId;
    await alice.from("roadmap_items").update({ status: "skipped" }).eq("id", next);
    expect(await close(projectId, threadId)).toEqual({ ok: true, redirect: `/projects/${projectId}/metrics?done=consult_closed` });
    expect((await statusOf(next)).status).toBe("skipped");
  });
});

describe("やることなしで始めた振り返り（分析の画面の「AI と振り返る」）", () => {
  it("今週のまだの振り返りのやることが 1 つだけなら、それを済みにする（種類のない前のやることは題名から推す）", async () => {
    const projectId = await newProject(alice);
    const review = await addItem(alice, projectId, "先週の数字を見る", null);
    const post = await addItem(alice, projectId, "1 本書く", "post");
    await addItem(alice, projectId, "来週の振り返り", "review", addDays(thisWeek, 7));
    const done = await addItem(alice, projectId, "済んだ振り返り", "review");
    await alice.from("roadmap_items").update({ status: "done" }).eq("id", done);

    const threadId = ((await step(projectId, { kind: "start", topic: "review" })) as { threadId: string }).threadId;
    expect(await close(projectId, threadId)).toEqual({ ok: true, redirect: `/projects/${projectId}/metrics?done=consult_closed&reviewed=${review}` });
    expect((await statusOf(review)).status).toBe("done");
    expect((await statusOf(post)).status).toBe("todo");
  });

  it("2 つ以上あれば済みにせず、ロードマップで済みにするよう知らせる", async () => {
    const projectId = await newProject(alice);
    const a = await addItem(alice, projectId, "数字を見る", "review");
    const b = await addItem(alice, projectId, "4 週間の振り返り", "review");
    const threadId = ((await step(projectId, { kind: "start", topic: "review" })) as { threadId: string }).threadId;
    expect(await close(projectId, threadId)).toEqual({ ok: true, redirect: `/projects/${projectId}/metrics?done=consult_closed&reviewed=many` });
    expect((await statusOf(a)).status).toBe("todo");
    expect((await statusOf(b)).status).toBe("todo");
  });

  it("ふだんの相談を終えても、振り返りのやることは変えない", async () => {
    const projectId = await newProject(alice);
    const review = await addItem(alice, projectId, "数字を見る", "review");
    const threadId = ((await step(projectId, { kind: "start", topic: "what_to_post" })) as { threadId: string }).threadId;
    expect(await close(projectId, threadId)).toEqual({ ok: true, redirect: `/projects/${projectId}/consult?done=consult_closed` });
    expect((await statusOf(review)).status).toBe("todo");
  });
});
