// AI と相談（F09、docs/architecture.md の 4.23）: 会話、「いまの状況」、提案の採用（設計・目標・やること・下書き）。
// AI は callModel をモックし、本物の Claude API は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { consultStep, type ConsultInput } from "@/lib/ai/consult";
import { normalizeConsultTurn } from "@/lib/ai/consult-schema";
import type { AiLimits } from "@/lib/ai/limits";
import type { CallModel, ModelResult } from "@/lib/ai/plan-coach";
import { weekStartOf } from "@/lib/roadmap/schema";
import { addDays, toYmd } from "@/lib/time";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const roomy: AiLimits = { userMonthlyUsd: 1000, globalMonthlyUsd: 100000, userDailyTurns: 1000 };
const usage = { inputTokens: 1000, cacheWriteTokens: 2000, cacheReadTokens: 3000, outputTokens: 500 };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const reply = (turn: unknown, extra: Partial<ModelResult> = {}): CallModel =>
  vi.fn(async () => ({ turn, stopReason: "end_turn", model: "claude-opus-5-5", usage, ...extra }));

const goal = { kgi: { statement: "1 か月で 12 本投稿する", kpi: "posts", target: 12, deadline: "2026-12-31" }, kpi_targets: [{ kpi: "posts", per_week: 3 }] };
const items = { items: [{ title: "柱「詰まった・直した」で 1 本書く", detail: "", week: 0, kpi: "posts", target: 1 }, { title: "週 3 回投稿する", detail: "", week: 1, kpi: "posts", target: 3 }] };
const roadmapTurn = {
  message: "目標とやることの案です。",
  choices: [],
  actions: [
    { kind: "goal", title: "1 か月で 12 本", reason: "続けることが最初の目標なので", value_json: JSON.stringify(goal) },
    { kind: "roadmap_items", title: "最初の 2 週間", reason: "小さく始めるため", value_json: JSON.stringify(items) },
    { kind: "post_draft", title: "最初の投稿", reason: "書き出しを手伝います", value_json: JSON.stringify({ sns: "threads", text: "【何を作ったか】を作っています。" }) },
  ],
};

// 数字は 4.22 の数字の画面から読む（ここでは偽物。サーバーでは loadMetricsOverview）
const loadKpiValues = async () => ({ posts: { thisWeek: 2, lastWeek: 1 } });

const step = (client: TestClient, userId: string, callModel: CallModel, threadId: string | null, input: ConsultInput) =>
  consultStep(client, admin, { callModel, limits: roomy, loadKpiValues }, { userId, projectId, threadId, input });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和", description: "家計簿アプリ", target_audience: "28 歳の会社員" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("AI と相談", () => {
  let threadId: string;
  let assistantId: string;

  it("よくある相談から始めると、会話（purpose = consult）を作り、いまの状況を渡し、利用量を記録する", async () => {
    const callModel = reply(roadmapTurn);
    const r = await step(alice, aliceId, callModel, null, { kind: "start", topic: "roadmap" });
    expect(r.ok).toBe(true);
    threadId = (r as { threadId: string }).threadId;

    const req = vi.mocked(callModel).mock.calls[0][0];
    const last = req.messages[req.messages.length - 1] as unknown as { role: string; content: string };
    expect(last.role).toBe("system");
    expect(last.content).toContain("かけいぼ日和");
    expect(last.content).toContain(`今日の日付: ${toYmd(new Date())}`);
    expect(last.content).toContain("KGI: まだ決めていない");
    expect(last.content).toContain("投稿した回数（posts）: 直近 7 日 2、その前の 7 日 1");
    expect(JSON.stringify(req.messages[0])).toContain("ロードマップ");

    const { data: thread } = await admin.from("ai_threads").select("purpose").eq("id", threadId).single();
    expect(thread!.purpose).toBe("consult");
    const { data: used } = await admin.from("ai_usage").select("purpose").eq("thread_id", threadId);
    expect(used).toEqual([{ purpose: "consult" }]);
    const { data: msgs } = await admin.from("ai_messages").select("id, role").eq("thread_id", threadId).order("created_at");
    assistantId = msgs!.find((m) => m.role === "assistant")!.id;
  });

  it("目標の提案を採用すると、ロードマップの目標になる（AI の案から）", async () => {
    const r = await step(alice, aliceId, reply({ message: "目標を入れました。", choices: [], actions: [] }), threadId, { kind: "adopt", messageId: assistantId, actionIndex: 0 });
    expect(r.ok).toBe(true);
    const { data } = await alice.from("roadmaps").select("kgi, kpi_targets, source").eq("project_id", projectId).single();
    expect(data).toMatchObject({ source: "ai", kgi: { statement: "1 か月で 12 本投稿する" }, kpi_targets: [{ kpi: "posts", per_week: 3 }] });
  });

  it("やることの提案は「何週目か」から日付にして足す。同じ提案は 2 回採用できない", async () => {
    const r = await step(alice, aliceId, reply({ message: "足しました。", choices: [], actions: [] }), threadId, { kind: "adopt", messageId: assistantId, actionIndex: 1 });
    expect(r.ok).toBe(true);
    const thisWeek = weekStartOf(toYmd(new Date()));
    const { data } = await alice.from("roadmap_items").select("title, week_start, source").eq("project_id", projectId).order("week_start");
    expect(data).toEqual([
      { title: "柱「詰まった・直した」で 1 本書く", week_start: thisWeek, source: "ai" },
      { title: "週 3 回投稿する", week_start: addDays(thisWeek, 7), source: "ai" },
    ]);
    const again = await step(alice, aliceId, reply({ message: "x", choices: [], actions: [] }), threadId, { kind: "adopt", messageId: assistantId, actionIndex: 1 });
    expect(again).toMatchObject({ ok: false, message: "この提案は採用済みです。" });
  });

  it("下書きの提案は、投稿の下書きを作って、その画面へ移る（AI の返事は待たない）", async () => {
    const callModel = reply({ message: "x", choices: [], actions: [] });
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: assistantId, actionIndex: 2 });
    expect(r.ok).toBe(true);
    const redirect = (r as { redirect?: string }).redirect!;
    expect(redirect).toMatch(new RegExp(`^/projects/${projectId}/posts/[0-9a-f-]+\\?done=idea$`));
    expect(callModel).not.toHaveBeenCalled();
    const postId = redirect.split("/posts/")[1].split("?")[0];
    const { data: post } = await alice.from("posts").select("body, status, post_targets(sns)").eq("id", postId).single();
    expect(post).toMatchObject({ body: "【何を作ったか】を作っています。", status: "draft", post_targets: [{ sns: "threads" }] });
  });

  it("次の往復には、ロードマップの目標とやることが「いまの状況」に入る", async () => {
    const callModel = reply({ message: "いいですね。", choices: [], actions: [] });
    await step(alice, aliceId, callModel, threadId, { kind: "text", text: "今週は何から？" });
    const req = vi.mocked(callModel).mock.calls[0][0];
    const ctx = (req.messages[req.messages.length - 1] as unknown as { content: string }).content;
    expect(ctx).toContain("KGI: 1 か月で 12 本投稿する");
    expect(ctx).toContain("柱「詰まった・直した」で 1 本書く");
    expect(ctx).toContain("posts 週 3");
  });

  it("ほかの人は、その会話で採用も発言もできない", async () => {
    const r = await consultStep(bob, admin, { callModel: reply(roadmapTurn), limits: roomy, loadKpiValues }, { userId: bobId, projectId, threadId, input: { kind: "text", text: "x" } });
    expect(r.ok).toBe(false);
  });

  it("提案の形が合わなければ 1 回だけ言い直させる。直らなければ、合うものだけを残す", async () => {
    const bad = { message: "案です。", choices: [], actions: [{ kind: "goal", title: "壊れた目標", reason: "", value_json: "{\"kgi\":{}}" }] };
    const fixed = { message: "直しました。", choices: [], actions: [{ kind: "goal", title: "直した目標", reason: "", value_json: JSON.stringify(goal) }] };
    const callModel = vi.fn<CallModel>()
      .mockResolvedValueOnce({ turn: bad, stopReason: "end_turn", model: "claude-opus-5-5", usage })
      .mockResolvedValueOnce({ turn: fixed, stopReason: "end_turn", model: "claude-opus-5-5", usage });
    const r = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "目標を見直したい" });
    expect(r.ok).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
    const { data: last } = await admin.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).single();
    expect((last!.content as { actions: { title: string }[] }).actions.map((a) => a.title)).toEqual(["直した目標"]);
  });

  it("断られたら、新しい会話は残さない", async () => {
    const r = await step(alice, aliceId, reply(null, { stopReason: "refusal" }), null, { kind: "start", topic: "no_reaction" });
    expect(r.ok).toBe(false);
    const { count } = await admin.from("ai_threads").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("purpose", "consult");
    expect(count).toBe(1);
  });
});

describe("AI と振り返る（4.22 の段取り ⑦）", () => {
  const review = {
    kpiValues: { posts: { thisWeek: 3, lastWeek: 1 }, views: { thisWeek: 1200, lastWeek: 800 } },
    clicksBySns: [{ label: "Threads", thisWeek: 4, lastWeek: 1, last30d: 9 }],
    topClicked: [{ title: "家計簿を 3 日続けるコツ", clicks: 5 }],
    topViewed: [{ title: "レシートを撮るだけで記録", views: 640 }],
  };

  it("振り返りの会話だけ、すべての数字・SNS ごとのクリック・よく見られた投稿を「いまの状況」に足す（相談と同じ purpose）", async () => {
    const loadReview = vi.fn(async () => review);
    const callModel = reply({ message: "閲覧数が増えました。", choices: [], actions: [] });
    const r = await consultStep(alice, admin, { callModel, limits: roomy, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: null, input: { kind: "start", topic: "review" } });
    expect(r.ok).toBe(true);
    const { data: t } = await admin.from("ai_threads").select("purpose").eq("id", r.ok ? r.threadId : "").single();
    expect(t?.purpose).toBe("consult");
    const req = vi.mocked(callModel).mock.calls[0][0];
    const ctx = JSON.stringify(req.messages[req.messages.length - 1]);
    expect(ctx).toContain("振り返りの材料");
    expect(ctx).toContain("レシートを撮るだけで記録");
    expect(ctx).toContain("直近 7 日 1200、その前の 7 日 800");
    // 数えていない数字は作らせない
    expect(ctx).toMatch(/ダウンロード（downloads）: まだ数えていない/);
    expect(JSON.stringify(req.messages[0])).toContain("最近の数字を振り返って");

    // 続けて話しても、振り返りの会話のあいだは材料を付ける
    const again = reply({ message: "はい。", choices: [], actions: [] });
    await consultStep(alice, admin, { callModel: again, limits: roomy, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: r.ok ? r.threadId : null, input: { kind: "text", text: "次は？" } });
    expect(loadReview).toHaveBeenCalledTimes(2);
  });

  it("ふだんの相談では材料を読まない（費用を抑える）", async () => {
    const loadReview = vi.fn(async () => review);
    const callModel = reply({ message: "はい。", choices: [], actions: [] });
    await consultStep(alice, admin, { callModel, limits: roomy, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: null, input: { kind: "start", topic: "what_to_post" } });
    expect(loadReview).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[0][0].messages)).not.toContain("振り返りの材料");
  });
});

describe("返事の検証", () => {
  it("種類ごとに中身を確かめる。下書きの SNS は決まった名前だけ", () => {
    const t = normalizeConsultTurn({
      message: "x",
      choices: ["a", "", "b", "c", "d", "e"],
      actions: [
        { kind: "post_draft", title: "t", reason: "", value_json: JSON.stringify({ sns: "mastodon", text: "x" }) },
        { kind: "roadmap_items", title: "t", reason: "", value_json: JSON.stringify({ items: [{ title: "x", week: 0, kpi: "posts", target: null }] }) },
        { kind: "plan_section", title: "t", reason: "", value_json: JSON.stringify({ section: "audience", value: { who: "会社員", pain: "家計", where: "夜" } }) },
      ],
    })!;
    expect(t.choices).toEqual(["a", "b", "c", "d"]);
    expect(t.actions.map((a) => a.kind)).toEqual(["plan_section"]);
    expect(t.actionProblem).toContain("post_draft");
    expect(t.actionProblem).toContain("roadmap_items");
  });
});
