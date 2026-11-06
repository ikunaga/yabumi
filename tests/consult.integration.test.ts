// AI と相談（F09、docs/architecture.md の 4.23）: 会話、「いまの状況」、提案の採用（設計・目標・やること・下書き）。1 回の返事は 1 つの項目の案 2〜3 個（2026-10-12）。
// AI は callModel をモックし、本物の Claude API は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GOAL_REVIEW_NOT_FOUND, LEGACY_GOAL_PROPOSAL, closeConsultThread, consultStep, type ConsultInput } from "@/lib/ai/consult";
import { normalizeConsultTurn, reviewHeadingOf, roadmapStepOf, roadmapStepState } from "@/lib/ai/consult-schema";
import { scopeAiBudget } from "./helpers/ai-budget";
import type { CallModel, ModelResult } from "@/lib/ai/plan-coach";
import { weekStartOf } from "@/lib/roadmap/schema";
import { addDays, toYmd } from "@/lib/time";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const usage = { inputTokens: 1000, cacheWriteTokens: 2000, cacheReadTokens: 3000, outputTokens: 500 };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const reply = (turn: unknown, extra: Partial<ModelResult> = {}): CallModel =>
  vi.fn(async () => ({ turn, stopReason: "end_turn", model: "claude-opus-5-5", usage, ...extra }));

// KGI は成果の数字（docs/design/goals-model.md）。中間の目標は 4 週ごと（12 週なら 3 つ）
const kgi = { kgi: { statement: "3 か月で 300 ダウンロード", metric: "downloads", action: null, sns: null, target: 300, weeks: 12, provisional: false }, milestones: [{ target: 60 }, { target: 100 }, { target: 140 }] };
const kgiSmall = { kgi: { statement: "3 か月で 150 ダウンロード", metric: "downloads", action: null, sns: null, target: 150, weeks: 12, provisional: false }, milestones: [{ target: 30 }, { target: 50 }, { target: 70 }] };
const targets = { kpis: [{ metric: "link_clicks", action: null, sns: null, per_week: 15 }] };
const weekly = { weekly: { x: 3 } };
// 前の形（roadmaps の KGI。2026-11-06 まで）
const legacyKgi = { statement: "1 か月で 12 本投稿する", kpi: "posts", target: 12, deadline: "2026-12-31", sns: null };
const items = { items: [{ title: "柱「詰まった・直した」で 1 本書く", detail: "", week: 0, kpi: "posts", target: 1 }, { title: "週 3 回投稿する", detail: "", week: 1, kpi: "posts", target: 3 }] };
const opt = (title: string, value: unknown) => ({ title, summary: `${title}の案`, pros: ["続けやすい"], cons: ["伸びは遅い"], value_json: JSON.stringify(value) });
// 1 回の返事で 1 つの項目（kind）だけ、案は 2〜3 個
const proposalTurn = (kind: string, options: ReturnType<typeof opt>[], message = "案です。") => ({ message, choices: [], proposal: { kind, options, recommended: 0, reason: "続けることが最初の目標なので" } });
const kgiTurn = proposalTurn("kgi", [opt("300 ダウンロード", kgi), opt("150 ダウンロード", kgiSmall)]);
const activeGoal = async () => {
  const { data: g } = await alice.from("goals").select("id, statement, metric, target, status, goal_milestones(seq, target), goal_kpis(role, metric, sns, per_week)").eq("project_id", projectId).eq("status", "active").single();
  return g!;
};
const plain = (message = "はい。") => ({ message, choices: [], proposal: null });
const contextOf = (callModel: CallModel) => {
  const req = vi.mocked(callModel).mock.calls[0][0];
  return (req.messages[req.messages.length - 1] as unknown as { content: string }).content;
};
const lastAssistantId = async (threadId: string) =>
  (await admin.from("ai_messages").select("id").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).single()).data!.id;

// 数字は 4.22 の数字の画面から読む（ここでは偽物。サーバーでは loadMetricsOverview）
const loadKpiValues = async () => ({ posts: { thisWeek: 2, lastWeek: 1 } });

const step = (client: TestClient, userId: string, callModel: CallModel, threadId: string | null, input: ConsultInput) =>
  consultStep(client, admin, { callModel, loadKpiValues }, { userId, projectId, threadId, input });

// 文章の AI の上限は、全体の合計を本人の分だけで数え、普段の枠で試す（helpers/ai-budget.ts）
scopeAiBudget();

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和", description: "家計簿アプリ", target_audience: "28 歳の会社員" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("AI と相談: ロードマップづくり（1 回 1 項目、順番に）", () => {
  let threadId: string;

  it("ロードマップから始めると、会話（purpose = consult）を作り、いまの状況と「次に決めるのは最終の目標」を渡し、利用量を記録する", async () => {
    const callModel = reply(kgiTurn);
    const r = await step(alice, aliceId, callModel, null, { kind: "start", topic: "roadmap" });
    expect(r.ok).toBe(true);
    threadId = (r as { threadId: string }).threadId;

    const ctx = contextOf(callModel);
    expect(ctx).toContain("かけいぼ日和");
    expect(ctx).toContain(`今日の日付: ${toYmd(new Date())}`);
    expect(ctx).toContain("KGI: まだ決めていない");
    expect(ctx).toContain("投稿した回数（posts）: 直近 7 日 2、その前の 7 日 1");
    expect(ctx).toContain("1. 最終の目標（kgi）: 次に決める");
    expect(ctx).toContain("2. 毎週の目標（kpi_targets）: まだ");
    const req = vi.mocked(callModel).mock.calls[0][0];
    expect(JSON.stringify(req.messages[0])).toContain("ロードマップ");
    expect(JSON.stringify(req.system)).toContain("1 回の返事で出す提案（proposal）は、1 つの項目だけ");

    const { data: thread } = await admin.from("ai_threads").select("purpose").eq("id", threadId).single();
    expect(thread!.purpose).toBe("consult");
    const { data: used } = await admin.from("ai_usage").select("purpose").eq("thread_id", threadId);
    expect(used).toEqual([{ purpose: "consult" }]);
    const { data: last } = await admin.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "assistant").single();
    expect((last!.content as { proposal: { kind: string; options: unknown[] } }).proposal).toMatchObject({ kind: "kgi", options: [{ title: "300 ダウンロード" }, { title: "150 ダウンロード" }] });
    // 指示: KGI は成果の数字、期限は 12 週、投稿の本数は KGI にしない。前の「1 か月で 12 本投稿する」の例はない
    const system = JSON.stringify(req.system);
    expect(system).toContain("成果の数字");
    expect(system).toContain("基本 12 週");
    expect(system).toContain("投稿の本数（posts）は KGI にしない");
    expect(system).not.toContain("1 か月で 12 本投稿する");
    expect(ctx).toContain("KGI に使える数字の候補:");
  });

  it("案を 1 つ採用すると、goals に最終の目標と 4 週ごとの中間の目標が入り、次の項目（毎週の目標）に進む。同じ提案のほかの案は選べない", async () => {
    const kgiMessage = await lastAssistantId(threadId);
    const callModel = reply(proposalTurn("kpi_targets", [opt("クリック週 15", targets), opt("クリック週 10", { kpis: [{ metric: "link_clicks", per_week: 10 }] })]));
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: kgiMessage, actionIndex: 1 });
    expect(r.ok).toBe(true);
    const g = await activeGoal();
    expect(g).toMatchObject({ statement: "3 か月で 150 ダウンロード", metric: "downloads", target: 150 });
    expect(g.goal_milestones.map((m) => Number(m.target)).sort((a, b) => a - b)).toEqual([30, 50, 70]);
    // 前の作り（roadmaps）には書かない
    expect((await alice.from("roadmaps").select("project_id").eq("project_id", projectId)).data).toEqual([]);
    // AI には「採用した、次の項目へ」と伝え、段取りは ① 済み・② 次
    const req = vi.mocked(callModel).mock.calls[0][0];
    expect(JSON.stringify(req.messages)).toContain("案「150 ダウンロード」を採用しました");
    const ctx = contextOf(callModel);
    expect(ctx).toContain("1. 最終の目標（kgi）: 済み");
    expect(ctx).toContain("2. 毎週の目標（kpi_targets）: 次に決める");
    expect(ctx).toContain("KGI: 3 か月で 150 ダウンロード（ダウンロード を 150");
    expect(ctx).toContain("中間の目標（4 週ごと）:");

    const again = await step(alice, aliceId, reply(plain()), threadId, { kind: "adopt", messageId: kgiMessage, actionIndex: 0 });
    expect(again).toMatchObject({ ok: false, message: "この提案は採用済みです。" });
  });

  it("毎週の目標（KPI）を採用しても、最終の目標は残る。次は投稿の週の本数", async () => {
    const callModel = reply(proposalTurn("action_targets", [opt("X 週 3", weekly), opt("X 週 2", { weekly: { x: 2 } })]));
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 });
    expect(r.ok).toBe(true);
    const g = await activeGoal();
    expect(g.statement).toBe("3 か月で 150 ダウンロード");
    expect(g.goal_kpis.filter((k) => k.role === "kpi")).toMatchObject([{ metric: "link_clicks", per_week: 15 }]);
    expect(contextOf(callModel)).toContain("3. 投稿の週の本数（action_targets）: 次に決める");
  });

  it("投稿の週の本数を採用すると行動の目標になり、アカウント設計を保存しても目標は戻らない。次は今週・来週のやること", async () => {
    const callModel = reply(proposalTurn("roadmap_items", [opt("最初の 2 週間", items), opt("今週だけ", { items: [items.items[0]] })]));
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 });
    expect(r.ok).toBe(true);
    expect((await activeGoal()).goal_kpis.filter((k) => k.role === "action")).toMatchObject([{ metric: "posts", sns: "x", per_week: 3 }]);
    expect(contextOf(callModel)).toContain("4. 今週・来週のやること（near_items）: 次に決める");
    // 橋渡し（fix/goals-bridge）: アカウント設計のほかのセクションを保存しても、KGI と KPI は上書きされない
    await alice.from("account_plans").upsert({ project_id: projectId, data: { goal: { what: "家計簿", goalType: "download", note: "" }, first_month: { goal: "", metrics: "", kpis: [], weekly: { x: 3 } } } }, { onConflict: "project_id" });
    const g = await activeGoal();
    expect(g).toMatchObject({ statement: "3 か月で 150 ダウンロード", target: 150 });
    expect(g.goal_kpis.filter((k) => k.role === "kpi")).toHaveLength(1);
  });

  it("やることの案は「何週目か」から日付にして足す。済んだら次はその先の週", async () => {
    const callModel = reply(plain("ロードマップができました。"));
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 });
    expect(r.ok).toBe(true);
    const thisWeek = weekStartOf(toYmd(new Date()));
    const { data } = await alice.from("roadmap_items").select("title, week_start, source").eq("project_id", projectId).order("week_start");
    expect(data).toEqual([
      { title: "柱「詰まった・直した」で 1 本書く", week_start: thisWeek, source: "ai" },
      { title: "週 3 回投稿する", week_start: addDays(thisWeek, 7), source: "ai" },
    ]);
    expect(contextOf(callModel)).toContain("5. その先のやること（later_items）: 次に決める");
  });

  it("下書きの案は 2〜3 本から選び、選んだ本文で下書きを作って、その画面へ移る（AI の返事は待たない）", async () => {
    await step(
      alice,
      aliceId,
      reply(proposalTurn("post_draft", [opt("作った話", { sns: "threads", text: "【何を作ったか】を作っています。" }), opt("困りごと", { sns: "threads", text: "家計簿、続かない問題。" })])),
      threadId,
      { kind: "text", text: "下書きもほしい" },
    );
    const callModel = reply(plain("x"));
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 1 });
    expect(r.ok).toBe(true);
    const redirect = (r as { redirect?: string }).redirect!;
    expect(redirect).toMatch(new RegExp(`^/projects/${projectId}/posts/[0-9a-f-]+\\?done=idea$`));
    expect(callModel).not.toHaveBeenCalled();
    const postId = redirect.split("/posts/")[1].split("?")[0];
    const { data: post } = await alice.from("posts").select("body, status, post_targets(sns)").eq("id", postId).single();
    expect(post).toMatchObject({ body: "家計簿、続かない問題。", status: "draft", post_targets: [{ sns: "threads" }] });
  });

  it("ほかの人は、その会話で採用も発言もできない", async () => {
    const r = await consultStep(bob, admin, { callModel: reply(kgiTurn), loadKpiValues }, { userId: bobId, projectId, threadId, input: { kind: "text", text: "x" } });
    expect(r.ok).toBe(false);
  });

  it("案の形が合わなければ 1 回だけ言い直させる", async () => {
    const bad = proposalTurn("kgi", [{ ...opt("壊れた目標", {}), value_json: '{"kgi":{}}' }, opt("300 ダウンロード", kgi)]);
    const fixed = proposalTurn("kgi", [opt("直した目標", kgi), opt("150 ダウンロード", kgiSmall)], "直しました。");
    const callModel = vi.fn<CallModel>()
      .mockResolvedValueOnce({ turn: bad, stopReason: "end_turn", model: "claude-opus-5-5", usage })
      .mockResolvedValueOnce({ turn: fixed, stopReason: "end_turn", model: "claude-opus-5-5", usage });
    const r = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "目標を見直したい" });
    expect(r.ok).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(callModel.mock.calls[1][0].messages)).toContain("1 回の提案は 1 つの項目だけ");
    const { data: last } = await admin.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).single();
    expect((last!.content as { proposal: { options: { title: string }[] } }).proposal.options.map((o) => o.title)).toEqual(["直した目標", "150 ダウンロード"]);
  });

  it("前の形で保存された会話（1 つの返事に種類の違う提案が並ぶ）も読めて、やることは採用できる。前の形の目標は採用しない", async () => {
    const { data: t } = await admin.from("ai_threads").insert({ owner_id: aliceId, project_id: projectId, purpose: "consult" }).select("id").single();
    await admin.from("ai_messages").insert({ thread_id: t!.id, owner_id: aliceId, role: "user", content: { kind: "start", topic: "roadmap" } });
    const legacy = {
      message: "目標とやることの案です。",
      choices: [],
      adopted: [],
      actions: [
        { kind: "goal", title: "1 か月で 12 本", reason: "", kgi: legacyKgi, kpiTargets: [{ kpi: "posts", per_week: 4 }] },
        { kind: "roadmap_items", title: "来週", reason: "", items: [{ title: "前の形のやること", detail: "", week: 1, kpi: null, target: null }] },
      ],
    };
    const { data: m } = await admin.from("ai_messages").insert({ thread_id: t!.id, owner_id: aliceId, role: "assistant", content: legacy }).select("id").single();
    const callModel = reply(plain());
    const r = await step(alice, aliceId, callModel, t!.id, { kind: "adopt", messageId: m!.id, actionIndex: 1 });
    expect(r.ok).toBe(true);
    const { data: item } = await alice.from("roadmap_items").select("title").eq("project_id", projectId).eq("title", "前の形のやること");
    expect(item).toHaveLength(1);
    // 履歴は新しい形で渡す（前の提案は文で添える）
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[0][0].messages)).toContain("このときの提案: 1 か月で 12 本（goal）、来週（roadmap_items）");
    // 前の形の目標（roadmaps の KGI）は、いまの目標の形と違うので採用しない（目標は変わらない）
    const r2 = await step(alice, aliceId, reply(plain()), t!.id, { kind: "adopt", messageId: m!.id, actionIndex: 0 });
    expect(r2).toMatchObject({ ok: false, message: LEGACY_GOAL_PROPOSAL });
    expect((await activeGoal()).statement).toBe("3 か月で 150 ダウンロード");
  });

  it("断られたら、新しい会話は残さない", async () => {
    const { count: before } = await admin.from("ai_threads").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("purpose", "consult");
    const r = await step(alice, aliceId, reply(null, { stopReason: "refusal" }), null, { kind: "start", topic: "no_reaction" });
    expect(r.ok).toBe(false);
    const { count } = await admin.from("ai_threads").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("purpose", "consult");
    expect(count).toBe(before);
  });

  it("ロードマップ以外の入口では、段取りを渡さない", async () => {
    const callModel = reply(plain());
    await step(alice, aliceId, callModel, null, { kind: "start", topic: "what_to_post" });
    expect(contextOf(callModel)).not.toContain("ロードマップづくりの段取り");
  });
});

describe("目標の案の検証（docs/design/goals-model.md）", () => {
  it("投稿の本数（posts）は KGI にも KPI にもしない。中間の目標は 4 週ごとの数だけ", () => {
    const posts = normalizeConsultTurn(proposalTurn("kgi", [opt("12 本", { kgi: { ...kgi.kgi, metric: "posts" }, milestones: kgi.milestones })]))!;
    expect(posts.proposal).toBeNull();
    expect(posts.proposalProblem).toContain("posts（投稿した回数）は KGI にも KPI にもしません");
    const kpiPosts = normalizeConsultTurn(proposalTurn("kpi_targets", [opt("週 3 本", { kpis: [{ metric: "posts", per_week: 3 }] })]))!;
    expect(kpiPosts.proposalProblem).toContain("posts");
    const two = normalizeConsultTurn(proposalTurn("kgi", [opt("2 つだけ", { ...kgi, milestones: [{ target: 100 }, { target: 200 }] })]))!;
    expect(two.proposalProblem).toContain("milestones は 3 個");
    // 成果（outcomes）は action が要る。仮の KGI（クリック）は provisional
    const outcome = normalizeConsultTurn(proposalTurn("kgi", [opt("予約", { kgi: { statement: "3 か月で予約 30 件", metric: "outcomes", action: "booking", target: 30, weeks: 12 }, milestones: [{ target: 6 }, { target: 10 }, { target: 14 }] })]))!;
    expect(outcome.proposal!.options[0]).toMatchObject({ kind: "goal_plan", goal: { metric: "outcomes", action: "booking", weeks: 12, provisional: false } });
    const noAction = normalizeConsultTurn(proposalTurn("kgi", [opt("予約", { kgi: { statement: "予約", metric: "outcomes", target: 30, weeks: 12 }, milestones: [{ target: 6 }, { target: 10 }, { target: 14 }] })]))!;
    expect(noAction.proposal).toBeNull();
    const provisional = normalizeConsultTurn(proposalTurn("kgi", [opt("クリック", { kgi: { statement: "3 か月でクリック 90", metric: "link_clicks", target: 90, weeks: 12, provisional: true }, milestones: [{ target: 20 }, { target: 30 }, { target: 40 }] })]))!;
    expect(provisional.proposal!.options[0]).toMatchObject({ goal: { provisional: true } });
  });

  it("「期限まで続ける」（keep）と次の目標を並べられる。keep は 1 つだけ。週の本数・見直しの形も確かめる", () => {
    const t = normalizeConsultTurn(proposalTurn("kgi", [opt("続ける", { keep: true }), opt("次へ", { ...kgi, weekly: { x: 2, threads: 1 } }), opt("もう 1 つ続ける", { keep: true })]))!;
    expect(t.proposal!.options.map((o) => o.kind)).toEqual(["goal_keep", "goal_plan"]);
    expect(t.proposal!.options[1]).toMatchObject({ weekly: [{ sns: "x", per_week: 2 }, { sns: "threads", per_week: 1 }] });
    expect(t.proposalProblem).toContain("1 つだけ");
    expect(normalizeConsultTurn(proposalTurn("action_targets", [opt("多すぎ", { weekly: { x: 20 } })]))!.proposalProblem).toContain("1〜14");
    expect(normalizeConsultTurn(proposalTurn("action_targets", [opt("知らない", { weekly: { mastodon: 2 } })]))!.proposalProblem).toContain("SNS の名前ではありません");
    expect(normalizeConsultTurn(proposalTurn("revise_goal", [opt("何も変えない", { statement: null, target: null, extend_weeks: 0 })]))!.proposalProblem).toContain("どれかを変えて");
    expect(normalizeConsultTurn(proposalTurn("revise_goal", [opt("のばす", { target: 120, extend_weeks: 4 })]))!.proposal!.options[0]).toMatchObject({ kind: "goal_revise", target: 120, extendWeeks: 4 });
  });
});

describe("目標の振り返り（goal_review）と毎月の振り返り（month_review）", () => {
  let gProject: string;
  let goalId: string;
  const gStep = (callModel: CallModel, threadId: string | null, input: ConsultInput) => consultStep(alice, admin, { callModel, loadKpiValues }, { userId: aliceId, projectId: gProject, threadId, input });
  const active = async () => (await alice.from("goals").select("id, statement, status, goal_kpis(role, sns, per_week)").eq("project_id", gProject).eq("status", "active").single()).data!;

  beforeAll(async () => {
    gProject = (await alice.from("projects").insert({ name: "こむぎ日和", product_type: "shop" }).select("id").single()).data!.id;
    const { data, error } = await alice.rpc("start_goal", {
      p_project_id: gProject,
      p_goal: { statement: "3 か月で予約 30 件", metric: "outcomes", action: "booking", target: 30, weeks: 12 } as never,
      p_milestones: [6, 10, 14] as never,
      p_kpis: null as never,
      p_actions: [{ sns: "instagram", per_week: 2 }] as never,
      p_source: "ai",
    });
    if (error) throw error;
    goalId = data as string;
  });

  it("期限が来ていない・届いていない目標や、他人の目標では始めない（会話を作らない）", async () => {
    const callModel = reply(plain());
    expect(await gStep(callModel, null, { kind: "start", topic: "goal_review", goalId })).toMatchObject({ ok: false, message: GOAL_REVIEW_NOT_FOUND });
    expect(await gStep(callModel, null, { kind: "start", topic: "goal_review" })).toMatchObject({ ok: false, message: GOAL_REVIEW_NOT_FOUND });
    expect(await gStep(callModel, null, { kind: "start", topic: "what_to_post", goalId })).toMatchObject({ ok: false, message: GOAL_REVIEW_NOT_FOUND });
    const other = await consultStep(bob, admin, { callModel, loadKpiValues }, { userId: bobId, projectId: gProject, threadId: null, input: { kind: "start", topic: "goal_review", goalId } });
    expect(other.ok).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
    const { count } = await admin.from("ai_threads").select("id", { count: "exact", head: true }).eq("project_id", gProject);
    expect(count).toBe(0);
  });

  it("毎月の振り返りでは、中間の目標を渡し、次の 4 週の目標と週の本数を採用すると区切りが今週から始まる", async () => {
    const callModel = reply(proposalTurn("milestone", [opt("同じペース", { target: 8, weekly: { instagram: 3 } }), opt("減らす", { target: 5, weekly: null })]));
    const r = await gStep(callModel, null, { kind: "start", topic: "month_review" });
    expect(r.ok).toBe(true);
    const ctx = contextOf(callModel);
    expect(ctx).toContain("中間の目標（4 週ごと）:");
    expect(ctx).toContain("予約（手で記録）");
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[0][0].system)).toContain("次の 1 か月の中間の目標と、週の本数を決める");
    const threadId = (r as { threadId: string }).threadId;
    const adopt = await gStep(reply(plain("今回の 1 か月の振り返りはここまでです。")), threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 });
    expect(adopt.ok).toBe(true);
    const thisWeek = weekStartOf(toYmd(new Date()));
    const { data: ms } = await alice.from("goal_milestones").select("starts_on, target").eq("goal_id", goalId).eq("starts_on", thisWeek);
    expect(ms).toMatchObject([{ target: 8 }]);
    expect((await active()).goal_kpis.filter((k) => k.role === "action")).toMatchObject([{ sns: "instagram", per_week: 3 }]);
  });

  it("期限が来たら始められる。結果と「次の 1 か月もこの中で決める」を渡し、次の目標を採用すると前の目標を閉じて新しい目標を始める。終えると goal=started", async () => {
    // 期限を過ぎた目標にする（サーバーの権限で日付だけ動かす）
    const monday = weekStartOf(toYmd(new Date()));
    await admin.from("goal_milestones").delete().eq("goal_id", goalId);
    await admin.from("goals").update({ starts_on: addDays(monday, -84), ends_on: addDays(monday, -1) }).eq("id", goalId);
    const next = { kgi: { statement: "3 か月で予約 40 件", metric: "outcomes", action: "booking", target: 40, weeks: 12 }, milestones: [{ target: 10 }, { target: 13 }, { target: 17 }], weekly: { instagram: 2 } };
    const callModel = reply(proposalTurn("kgi", [opt("予約 40 件", next), opt("クリックに替える", { kgi: { statement: "3 か月でクリック 90", metric: "link_clicks", target: 90, weeks: 12, provisional: true }, milestones: [{ target: 20 }, { target: 30 }, { target: 40 }] })]));
    const r = await gStep(callModel, null, { kind: "start", topic: "goal_review", goalId });
    expect(r.ok).toBe(true);
    const threadId = (r as { threadId: string }).threadId;
    const ctx = contextOf(callModel);
    expect(ctx).toContain("# 目標の振り返り");
    expect(ctx).toContain("KGI の期限が来た");
    expect(ctx).toContain("次の 1 か月もこの中で決める");
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[0][0].messages[0])).toContain("次の目標を決めたい");
    // 最初の発言に、どの目標の振り返りかを残す（概要の帯が読む）
    const { data: first } = await alice.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "user").single();
    expect(first!.content).toMatchObject({ kind: "start", topic: "goal_review", goalId });

    const wrap = { message: "今回の目標の振り返りはここまでです。", choices: [], proposal: null, wrap_up: { summary: "次は 3 か月で予約 40 件" } };
    expect((await gStep(reply(wrap), threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 })).ok).toBe(true);
    const { data: old } = await alice.from("goals").select("status, result_value").eq("id", goalId).single();
    expect(old).toMatchObject({ status: "expired" });
    const now = await active();
    expect(now.statement).toBe("3 か月で予約 40 件");
    expect(now.goal_kpis.filter((k) => k.role === "action")).toMatchObject([{ sns: "instagram", per_week: 2 }]);

    const closed = await closeConsultThread(alice, admin, { userId: aliceId, projectId: gProject, threadId });
    expect(closed).toMatchObject({ ok: true, redirect: `/projects/${gProject}?done=consult_closed&goal=started` });
  });

  it("「期限まで続ける」を選ぶと目標は変えず、終えると goal=kept", async () => {
    const { id } = await active();
    await admin.from("goal_milestones").delete().eq("goal_id", id);
    const monday = weekStartOf(toYmd(new Date()));
    await admin.from("goals").update({ starts_on: addDays(monday, -84), ends_on: addDays(monday, -1) }).eq("id", id);
    const r = await gStep(reply(proposalTurn("kgi", [opt("続ける", { keep: true }), opt("次へ", kgi)])), null, { kind: "start", topic: "goal_review", goalId: id });
    const threadId = (r as { threadId: string }).threadId;
    expect((await gStep(reply(plain()), threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 })).ok).toBe(true);
    expect((await active()).id).toBe(id);
    const closed = await closeConsultThread(alice, admin, { userId: aliceId, projectId: gProject, threadId });
    expect(closed).toMatchObject({ ok: true, redirect: `/projects/${gProject}?done=consult_closed&goal=kept` });
  });

  it("KGI を見直す案（revise_goal）は、文・目標の値・期限をのばす", async () => {
    const r = await gStep(reply(proposalTurn("revise_goal", [opt("のばす", { statement: "4 か月で予約 40 件", target: 40, extend_weeks: 4 }), opt("下げる", { target: 30 })])), null, { kind: "start", topic: "what_to_post" });
    const threadId = (r as { threadId: string }).threadId;
    const before = (await alice.from("goals").select("id, ends_on").eq("project_id", gProject).eq("status", "active").single()).data!;
    // 期限を過ぎた目標は、のばす先が今日より前だと DB が断るので、今日より先に戻してから試す
    const monday = weekStartOf(toYmd(new Date()));
    await admin.from("goals").update({ ends_on: addDays(monday, 13) }).eq("id", before.id);
    expect((await gStep(reply(plain()), threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 })).ok).toBe(true);
    const { data: g } = await alice.from("goals").select("statement, target, ends_on").eq("id", before.id).single();
    expect(g).toMatchObject({ statement: "4 か月で予約 40 件", target: 40, ends_on: addDays(monday, 13 + 28) });
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
    const callModel = reply({ message: "閲覧数が増えました。", choices: [], proposal: null });
    const r = await consultStep(alice, admin, { callModel, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: null, input: { kind: "start", topic: "review" } });
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
    const again = reply({ message: "はい。", choices: [], proposal: null });
    await consultStep(alice, admin, { callModel: again, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: r.ok ? r.threadId : null, input: { kind: "text", text: "次は？" } });
    expect(loadReview).toHaveBeenCalledTimes(2);
  });

  it("ふだんの相談では材料を読まない（費用を抑える）", async () => {
    const loadReview = vi.fn(async () => review);
    const callModel = reply({ message: "はい。", choices: [], proposal: null });
    await consultStep(alice, admin, { callModel, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: null, input: { kind: "start", topic: "what_to_post" } });
    expect(loadReview).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[0][0].messages)).not.toContain("振り返りの材料");
  });
});

describe("AI と相談: 下書きの文字数", () => {
  it("SNS の上限を超えた下書きの案は、1 回だけ縮めさせて保存し、その分の利用量も数える", async () => {
    const callModel = reply(proposalTurn("post_draft", [opt("長い", { sns: "x", text: "あ".repeat(150) }), opt("短い", { sns: "x", text: "短い" })]));
    const callShorten = vi.fn(async () => ({ output: { drafts: [{ id: "0", text: "あ".repeat(100) }] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { ...usage, outputTokens: 321 } }));
    const r = await consultStep(alice, admin, { callModel, callShorten, loadKpiValues }, { userId: aliceId, projectId, threadId: null, input: { kind: "start", topic: "what_to_post" } });
    expect(r.ok).toBe(true);
    const threadId = r.ok ? r.threadId : "";
    expect(callShorten).toHaveBeenCalledTimes(1);
    const { data: m } = await admin.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "assistant").single();
    expect((m!.content as { proposal: { options: { text: string }[] } }).proposal.options.map((o) => o.text)).toEqual(["あ".repeat(100), "短い"]);
    const { data: u } = await admin.from("ai_usage").select("output_tokens").eq("thread_id", threadId);
    expect(u!.map((x) => x.output_tokens)).toContain(321);
  });
});

describe("返事の検証", () => {
  it("1 つの項目の案を確かめる。合わない案は外して理由を返す。下書きの SNS は決まった名前だけ", () => {
    const t = normalizeConsultTurn({
      message: "x",
      choices: ["a", "", "b", "c", "d", "e"],
      proposal: {
        kind: "post_draft",
        options: [opt("1", { sns: "mastodon", text: "x" }), opt("2", { sns: "x", text: "本文" }), opt("3", { sns: null, text: "本文 3" }), opt("4", { sns: null, text: "4 つ目" })],
        recommended: 5,
        reason: "r",
      },
    })!;
    expect(t.choices).toEqual(["a", "b", "c", "d"]);
    // 案は 3 つまで読み、合わないもの（mastodon）を外す。おすすめの番号が範囲外なら 0
    expect(t.proposal!.options.map((o) => o.title)).toEqual(["2", "3"]);
    expect(t.proposal!.recommended).toBe(0);
    expect(t.proposalProblem).toContain("案 1");
  });

  it("アカウント設計の直しは、案がみな同じセクションのこと", () => {
    const t = normalizeConsultTurn({
      message: "x",
      choices: [],
      proposal: {
        kind: "plan_section",
        options: [
          opt("a", { section: "audience", value: { who: "会社員", pain: "家計", where: "夜" } }),
          opt("b", { section: "goal", value: { what: "x", goalType: null, note: "" } }),
        ],
        recommended: 0,
        reason: "",
      },
    })!;
    expect(t.proposal!.options.map((o) => o.title)).toEqual(["a"]);
    expect(t.proposalProblem).toContain("1 つのセクションだけ");
  });

  it("前の形（actions）の返事は、構造化出力の形に合わないので読まない", () => {
    expect(normalizeConsultTurn({ message: "x", choices: [], actions: [] })).toBeNull();
  });
});

describe("ロードマップづくりの段", () => {
  it("済んだ段を飛ばして次を決める。案がどの段か", () => {
    expect(roadmapStepState({ hasKgi: false, hasKpiTargets: true, hasActions: true, itemWeeks: [] }).next).toBe("kgi");
    expect(roadmapStepState({ hasKgi: true, hasKpiTargets: true, hasActions: false, itemWeeks: [] }).next).toBe("action_targets");
    expect(roadmapStepState({ hasKgi: true, hasKpiTargets: true, hasActions: true, itemWeeks: [3] }).next).toBe("near_items");
    expect(roadmapStepState({ hasKgi: true, hasKpiTargets: true, hasActions: true, itemWeeks: [0, 2] }).next).toBeNull();
    const near = normalizeConsultTurn(proposalTurn("roadmap_items", [opt("a", items)]))!.proposal!;
    expect(roadmapStepOf(near, "roadmap")).toBe("near_items");
    const later = normalizeConsultTurn(proposalTurn("roadmap_items", [opt("a", { items: [{ ...items.items[0], week: 3 }] })]))!.proposal!;
    expect(roadmapStepOf(later, "roadmap")).toBe("later_items");
    expect(roadmapStepOf(normalizeConsultTurn(kgiTurn)!.proposal!, "roadmap")).toBe("kgi");
    // ロードマップづくり以外の会話では段を出さない（振り返りの次の一手が「ロードマップづくり 3 / 4」と出ていた）
    for (const topic of ["review", "month_review", "goal_review", "what_to_post", null]) {
      expect(roadmapStepOf(near, topic)).toBeNull();
      expect(roadmapStepOf(normalizeConsultTurn(kgiTurn)!.proposal!, topic)).toBeNull();
    }
  });

  it("振り返りのゴールの案は、入口ごとの見出し（来週のやること・次の 1 か月の目標と週の本数・次の目標）", () => {
    const ms = normalizeConsultTurn(proposalTurn("milestone", [opt("同じペース", { target: 50, weekly: { x: 3 } }), opt("減らす", { target: 40, weekly: { x: 2 } })]))!.proposal!;
    expect(reviewHeadingOf(ms, "month_review")).toBe("次の 1 か月の目標と週の本数");
    expect(reviewHeadingOf(normalizeConsultTurn(kgiTurn)!.proposal!, "goal_review")).toBe("次の目標");
    const near = normalizeConsultTurn(proposalTurn("roadmap_items", [opt("a", items)]))!.proposal!;
    expect(reviewHeadingOf(near, "review")).toBe("来週のやること");
    const firstMonth = (x: number) => opt(`週 ${x}`, { section: "first_month", value: { goal: `X に週 ${x} 本`, metrics: "", kpis: ["posts"], weekly: { x } } });
    const month = normalizeConsultTurn(proposalTurn("plan_section", [firstMonth(2), firstMonth(3)]))!.proposal!;
    expect(month.options).toHaveLength(2);
    expect(reviewHeadingOf(month, "month_review")).toBe("次の 1 か月の週の回数");
    // ほかの入口・ほかの項目は、今までの見出し
    expect(reviewHeadingOf(near, "roadmap")).toBeNull();
    expect(reviewHeadingOf(near, "month_review")).toBeNull();
    expect(reviewHeadingOf(month, "review")).toBeNull();
    expect(reviewHeadingOf(normalizeConsultTurn(kgiTurn)!.proposal!, "review")).toBeNull();
  });
});
