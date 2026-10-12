// AI と相談（F09、docs/architecture.md の 4.23）: 会話、「いまの状況」、提案の採用（設計・目標・やること・下書き）。1 回の返事は 1 つの項目の案 2〜3 個（2026-10-12）。
// AI は callModel をモックし、本物の Claude API は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { consultStep, type ConsultInput } from "@/lib/ai/consult";
import { normalizeConsultTurn, roadmapStepOf, roadmapStepState } from "@/lib/ai/consult-schema";
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

const kgi = { kgi: { statement: "1 か月で 12 本投稿する", kpi: "posts", target: 12, deadline: "2026-12-31" } };
const kgiSmall = { kgi: { statement: "1 か月で 8 本投稿する", kpi: "posts", target: 8, deadline: "2026-12-31" } };
const targets = { kpi_targets: [{ kpi: "posts", per_week: 3 }] };
const items = { items: [{ title: "柱「詰まった・直した」で 1 本書く", detail: "", week: 0, kpi: "posts", target: 1 }, { title: "週 3 回投稿する", detail: "", week: 1, kpi: "posts", target: 3 }] };
const opt = (title: string, value: unknown) => ({ title, summary: `${title}の案`, pros: ["続けやすい"], cons: ["伸びは遅い"], value_json: JSON.stringify(value) });
// 1 回の返事で 1 つの項目（kind）だけ、案は 2〜3 個
const proposalTurn = (kind: string, options: ReturnType<typeof opt>[], message = "案です。") => ({ message, choices: [], proposal: { kind, options, recommended: 0, reason: "続けることが最初の目標なので" } });
const kgiTurn = proposalTurn("kgi", [opt("1 か月で 12 本", kgi), opt("1 か月で 8 本", kgiSmall)]);
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
    expect((last!.content as { proposal: { kind: string; options: unknown[] } }).proposal).toMatchObject({ kind: "kgi", options: [{ title: "1 か月で 12 本" }, { title: "1 か月で 8 本" }] });
  });

  it("案を 1 つ採用すると最終の目標になり、続けて次の項目（毎週の目標）の案に進む。同じ提案のほかの案は選べない", async () => {
    const kgiMessage = await lastAssistantId(threadId);
    const callModel = reply(proposalTurn("kpi_targets", [opt("週 3 本", targets), opt("週 2 本", { kpi_targets: [{ kpi: "posts", per_week: 2 }] })]));
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: kgiMessage, actionIndex: 1 });
    expect(r.ok).toBe(true);
    const { data } = await alice.from("roadmaps").select("kgi, kpi_targets, source").eq("project_id", projectId).single();
    expect(data).toMatchObject({ source: "ai", kgi: { statement: "1 か月で 8 本投稿する" }, kpi_targets: [] });
    // AI には「採用した、次の項目へ」と伝え、段取りは ① 済み・② 次
    const req = vi.mocked(callModel).mock.calls[0][0];
    expect(JSON.stringify(req.messages)).toContain("案「1 か月で 8 本」を採用しました");
    const ctx = contextOf(callModel);
    expect(ctx).toContain("1. 最終の目標（kgi）: 済み");
    expect(ctx).toContain("2. 毎週の目標（kpi_targets）: 次に決める");

    const again = await step(alice, aliceId, reply(plain()), threadId, { kind: "adopt", messageId: kgiMessage, actionIndex: 0 });
    expect(again).toMatchObject({ ok: false, message: "この提案は採用済みです。" });
  });

  it("毎週の目標を採用しても、最終の目標は残る。次は今週・来週のやること", async () => {
    const callModel = reply(proposalTurn("roadmap_items", [opt("最初の 2 週間", items), opt("今週だけ", { items: [items.items[0]] })]));
    const r = await step(alice, aliceId, callModel, threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 });
    expect(r.ok).toBe(true);
    const { data } = await alice.from("roadmaps").select("kgi, kpi_targets").eq("project_id", projectId).single();
    expect(data).toMatchObject({ kgi: { statement: "1 か月で 8 本投稿する" }, kpi_targets: [{ kpi: "posts", per_week: 3 }] });
    expect(contextOf(callModel)).toContain("3. 今週・来週のやること（near_items）: 次に決める");
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
    expect(contextOf(callModel)).toContain("4. その先のやること（later_items）: 次に決める");
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
    const r = await consultStep(bob, admin, { callModel: reply(kgiTurn), limits: roomy, loadKpiValues }, { userId: bobId, projectId, threadId, input: { kind: "text", text: "x" } });
    expect(r.ok).toBe(false);
  });

  it("案の形が合わなければ 1 回だけ言い直させる", async () => {
    const bad = proposalTurn("kgi", [{ ...opt("壊れた目標", {}), value_json: '{"kgi":{}}' }, opt("1 か月で 12 本", kgi)]);
    const fixed = proposalTurn("kgi", [opt("直した目標", kgi), opt("1 か月で 8 本", kgiSmall)], "直しました。");
    const callModel = vi.fn<CallModel>()
      .mockResolvedValueOnce({ turn: bad, stopReason: "end_turn", model: "claude-opus-5-5", usage })
      .mockResolvedValueOnce({ turn: fixed, stopReason: "end_turn", model: "claude-opus-5-5", usage });
    const r = await step(alice, aliceId, callModel, threadId, { kind: "text", text: "目標を見直したい" });
    expect(r.ok).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(callModel.mock.calls[1][0].messages)).toContain("1 回の提案は 1 つの項目だけ");
    const { data: last } = await admin.from("ai_messages").select("content").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).single();
    expect((last!.content as { proposal: { options: { title: string }[] } }).proposal.options.map((o) => o.title)).toEqual(["直した目標", "1 か月で 8 本"]);
  });

  it("前の形で保存された会話（1 つの返事に種類の違う提案が並ぶ）も読めて、提案ごとに採用できる", async () => {
    const { data: t } = await admin.from("ai_threads").insert({ owner_id: aliceId, project_id: projectId, purpose: "consult" }).select("id").single();
    await admin.from("ai_messages").insert({ thread_id: t!.id, owner_id: aliceId, role: "user", content: { kind: "start", topic: "roadmap" } });
    const legacy = {
      message: "目標とやることの案です。",
      choices: [],
      adopted: [],
      actions: [
        { kind: "goal", title: "1 か月で 12 本", reason: "", kgi: kgi.kgi, kpiTargets: [{ kpi: "posts", per_week: 4 }] },
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
    // 前の形は、同じ返事のほかの提案も採用できる
    const r2 = await step(alice, aliceId, reply(plain()), t!.id, { kind: "adopt", messageId: m!.id, actionIndex: 0 });
    expect(r2.ok).toBe(true);
    const { data: rm } = await alice.from("roadmaps").select("kpi_targets").eq("project_id", projectId).single();
    expect(rm!.kpi_targets).toEqual([{ kpi: "posts", per_week: 4 }]);
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
    const again = reply({ message: "はい。", choices: [], proposal: null });
    await consultStep(alice, admin, { callModel: again, limits: roomy, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: r.ok ? r.threadId : null, input: { kind: "text", text: "次は？" } });
    expect(loadReview).toHaveBeenCalledTimes(2);
  });

  it("ふだんの相談では材料を読まない（費用を抑える）", async () => {
    const loadReview = vi.fn(async () => review);
    const callModel = reply({ message: "はい。", choices: [], proposal: null });
    await consultStep(alice, admin, { callModel, limits: roomy, loadKpiValues, loadReview }, { userId: aliceId, projectId, threadId: null, input: { kind: "start", topic: "what_to_post" } });
    expect(loadReview).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[0][0].messages)).not.toContain("振り返りの材料");
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
    expect(roadmapStepState({ hasKgi: false, hasKpiTargets: true, itemWeeks: [] }).next).toBe("kgi");
    expect(roadmapStepState({ hasKgi: true, hasKpiTargets: true, itemWeeks: [3] }).next).toBe("near_items");
    expect(roadmapStepState({ hasKgi: true, hasKpiTargets: true, itemWeeks: [0, 2] }).next).toBeNull();
    const near = normalizeConsultTurn(proposalTurn("roadmap_items", [opt("a", items)]))!.proposal!;
    expect(roadmapStepOf(near)).toBe("near_items");
    const later = normalizeConsultTurn(proposalTurn("roadmap_items", [opt("a", { items: [{ ...items.items[0], week: 3 }] })]))!.proposal!;
    expect(roadmapStepOf(later)).toBe("later_items");
    expect(roadmapStepOf(normalizeConsultTurn(kgiTurn)!.proposal!)).toBe("kgi");
  });
});
