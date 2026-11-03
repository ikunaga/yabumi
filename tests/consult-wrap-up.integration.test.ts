// AI と相談の会話の終わり（docs/architecture.md の 4.23）: AI の区切り、済みにする、済んだ会話に送れない、他人の会話は済みにできない、長くなったときの勧め。
// AI は callModel をモックし、本物の Claude API は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CLOSED_THREAD_MESSAGE, closeConsultThread, consultStep, type ConsultInput } from "@/lib/ai/consult";
import type { CallModel, ModelResult } from "@/lib/ai/plan-coach";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const usage = { inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 500 };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const reply = (turn: unknown, extra: Partial<ModelResult> = {}): CallModel =>
  vi.fn(async () => ({ turn, stopReason: "end_turn", model: "claude-opus-5-5", usage, ...extra }));
const loadKpiValues = async () => ({ posts: { thisWeek: 2, lastWeek: 1 } });
const step = (callModel: CallModel, threadId: string | null, input: ConsultInput) =>
  consultStep(alice, admin, { callModel, loadKpiValues }, { userId: aliceId, projectId, threadId, input });
const close = (threadId: string, client = alice, userId = aliceId) => closeConsultThread(client, admin, { userId, projectId, threadId });
const contextOf = (callModel: CallModel) => {
  const req = vi.mocked(callModel).mock.calls[0][0];
  return (req.messages[req.messages.length - 1] as unknown as { content: string }).content;
};
const lastAssistantId = async (threadId: string) =>
  (await admin.from("ai_messages").select("id").eq("thread_id", threadId).eq("role", "assistant").order("created_at", { ascending: false }).limit(1).single()).data!.id;
const threadRow = async (threadId: string) => (await admin.from("ai_threads").select("closed_at, summary").eq("id", threadId).single()).data!;

const item = (title: string, week: number) => ({ title, detail: "", week, kpi: null, target: null, sns: null, kind: "post" });
const nextStep = {
  message: "よかった点は…。次の一手の案です。",
  choices: [],
  proposal: {
    kind: "roadmap_items",
    options: [
      { title: "続ける", summary: "", pros: [], cons: [], value_json: JSON.stringify({ items: [item("柱「季節」で 1 本書く", 1), item("土曜に数字を見る", 1)] }) },
      { title: "まねる", summary: "", pros: [], cons: [], value_json: JSON.stringify({ items: [item("よく見られた型で 1 本", 1)] }) },
    ],
    recommended: 0,
    reason: "続けることが先なので",
  },
  wrap_up: null,
};
const wrapUp = { message: "今回の振り返りはここまでです。\n・来週は 2 つ", choices: [], proposal: null, wrap_up: { summary: "来週は柱「季節」で 1 本、土曜に数字を見る" } };
const plain = (message = "はい。") => ({ message, choices: [], proposal: null, wrap_up: null });

scopeAiBudget();

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "季節の器", description: "器の店", target_audience: "30 代" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("振り返りのゴールで区切って、終える", () => {
  let threadId: string;

  it("次の一手を採用すると、AI が区切り（まとめ）を返し、そのまま保存する", async () => {
    const r = await step(reply(nextStep), null, { kind: "start", topic: "review" });
    threadId = (r as { threadId: string }).threadId;
    const callModel = reply(wrapUp);
    const r2 = await step(callModel, threadId, { kind: "adopt", messageId: await lastAssistantId(threadId), actionIndex: 0 });
    expect(r2.ok).toBe(true);
    // AI への指示に、区切りの決まりがある
    expect(JSON.stringify(vi.mocked(callModel).mock.calls[0][0].system)).toContain("# 会話の区切り");
    const { data: last } = await admin.from("ai_messages").select("content").eq("id", await lastAssistantId(threadId)).single();
    expect(last!.content).toMatchObject({ choices: [], proposal: null, wrapUp: { summary: "来週は柱「季節」で 1 本、土曜に数字を見る" } });
    expect((await threadRow(threadId)).closed_at).toBeNull();
  });

  it("ほかの人は、その会話を済みにできない", async () => {
    const r = await close(threadId, bob, bobId);
    expect(r).toEqual({ ok: false, message: "会話が見つかりません。画面を読み込み直してください。" });
    // 自分の userId を名乗っても、RLS で読めないので断る
    expect((await close(threadId, bob, aliceId)).ok).toBe(false);
    expect(await threadRow(threadId)).toEqual({ closed_at: null, summary: null });
  });

  it("これで終わる: 済みにして、AI のまとめを保存し、分析の画面に戻る（来週のやることの数を添える）", async () => {
    const r = await close(threadId);
    expect(r).toEqual({ ok: true, redirect: `/projects/${projectId}/metrics?done=consult_closed&items=2` });
    const row = await threadRow(threadId);
    expect(row.closed_at).not.toBeNull();
    expect(row.summary).toBe("来週は柱「季節」で 1 本、土曜に数字を見る");
    // 本人は読める（一覧のまとめ）、他人は読めない
    const { data: mine } = await alice.from("ai_threads").select("closed_at, summary").eq("id", threadId);
    expect(mine).toEqual([row]);
    const { data: others } = await bob.from("ai_threads").select("summary").eq("id", threadId);
    expect(others).toEqual([]);
  });

  it("済んだ会話には、送れない・採用できない（AI も呼ばない）。もう一度終えることもできない", async () => {
    const callModel = reply(plain());
    expect(await step(callModel, threadId, { kind: "text", text: "もう一つ" })).toEqual({ ok: false, threadId, message: CLOSED_THREAD_MESSAGE });
    const first = (await admin.from("ai_messages").select("id").eq("thread_id", threadId).eq("role", "assistant").order("created_at").limit(1).single()).data!.id;
    expect((await step(callModel, threadId, { kind: "adopt", messageId: first, actionIndex: 1 })).ok).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
    expect(await close(threadId)).toEqual({ ok: false, message: "この相談はもう済んでいます。" });
  });

  it("DB でも、済んだ会話への発言・返事の書き換え・済みを外すこと・まとめの書き換えを断る（サーバーの権限でも）", async () => {
    const ins = await admin.from("ai_messages").insert({ thread_id: threadId, owner_id: aliceId, role: "user", content: { kind: "text", text: "x" } });
    expect(ins.error?.code).toBe("55000");
    const upd = await admin.from("ai_messages").update({ content: { message: "x", choices: [], proposal: null } }).eq("id", await lastAssistantId(threadId));
    expect(upd.error?.code).toBe("55000");
    expect((await admin.from("ai_threads").update({ closed_at: null }).eq("id", threadId)).error?.code).toBe("55000");
    expect((await admin.from("ai_threads").update({ summary: "書き換え" }).eq("id", threadId)).error?.code).toBe("55000");
    // 利用者は ai_threads を書き換えられない（今までどおり）
    await alice.from("ai_threads").update({ closed_at: null }).eq("id", threadId);
    expect((await threadRow(threadId)).closed_at).not.toBeNull();
  });

  it("済んだ会話も、本人は削除できる（中身もカスケードで消える）", async () => {
    const { data } = await alice.from("ai_threads").delete().eq("id", threadId).select("id");
    expect(data).toHaveLength(1);
    const { count } = await admin.from("ai_messages").select("id", { count: "exact", head: true }).eq("thread_id", threadId);
    expect(count).toBe(0);
  });
});

describe("区切っていない会話を終える", () => {
  it("AI がまとめていないときは、まとめは空のまま済みにする。ふだんの相談は相談の一覧に戻る", async () => {
    const r = await step(reply(plain("こうしてみては。")), null, { kind: "text", text: "何を投稿すればいい？" });
    const threadId = (r as { threadId: string }).threadId;
    expect(await close(threadId)).toEqual({ ok: true, redirect: `/projects/${projectId}/consult?done=consult_closed` });
    expect(await threadRow(threadId)).toMatchObject({ summary: null });
  });

  it("区切ったあとに「もう少し相談する」で続けたら、前のまとめは使わない", async () => {
    const r = await step(reply(wrapUp), null, { kind: "start", topic: "what_to_post" });
    const threadId = (r as { threadId: string }).threadId;
    await step(reply(plain("続きです。")), threadId, { kind: "text", text: "もう一つ聞きたい" });
    expect((await close(threadId)).ok).toBe(true);
    expect((await threadRow(threadId)).summary).toBeNull();
  });

  it("1 か月の振り返りは概要に戻る", async () => {
    const r = await step(reply(wrapUp), null, { kind: "start", topic: "month_review" });
    const threadId = (r as { threadId: string }).threadId;
    expect(await close(threadId)).toEqual({ ok: true, redirect: `/projects/${projectId}?done=consult_closed` });
  });

  it("済んでいない会話には、今までどおりサーバーが書ける（前の版のコードもトリガーに当たらない）", async () => {
    const { data: t } = await admin.from("ai_threads").insert({ owner_id: aliceId, project_id: projectId, purpose: "consult" }).select("id").single();
    expect((await admin.from("ai_messages").insert({ thread_id: t!.id, owner_id: aliceId, role: "user", content: { kind: "text", text: "x" } })).error).toBeNull();
    expect((await admin.from("ai_threads").update({ updated_at: new Date().toISOString() }).eq("id", t!.id)).error).toBeNull();
  });
});

describe("長くなったときの勧め", () => {
  it("21 往復目だけ、新しい相談に分けるよう勧めさせる（往復の数は毎回渡す）", async () => {
    const { data: t } = await admin.from("ai_threads").insert({ owner_id: aliceId, project_id: projectId, purpose: "consult" }).select("id").single();
    const threadId = t!.id;
    const rows = [];
    for (let i = 0; i < 20; i++) {
      rows.push({ thread_id: threadId, owner_id: aliceId, role: "user", content: { kind: "text", text: `質問 ${i}` }, created_at: new Date(Date.now() - (40 - 2 * i) * 1000).toISOString() });
      rows.push({ thread_id: threadId, owner_id: aliceId, role: "assistant", content: { ...plain(`答え ${i}`), adopted: [] }, created_at: new Date(Date.now() - (39 - 2 * i) * 1000).toISOString() });
    }
    expect((await admin.from("ai_messages").insert(rows)).error).toBeNull();

    const at21 = reply(plain());
    expect((await step(at21, threadId, { kind: "text", text: "21 回目" })).ok).toBe(true);
    expect(contextOf(at21)).toContain("この会話の往復: 21 回目");
    expect(contextOf(at21)).toContain("この返事で一度だけ、新しい相談に分けるよう勧める");

    const at22 = reply(plain());
    expect((await step(at22, threadId, { kind: "text", text: "22 回目" })).ok).toBe(true);
    expect(contextOf(at22)).toContain("この会話の往復: 22 回目");
    expect(contextOf(at22)).not.toContain("新しい相談に分けるよう勧める");
  });
});

describe("退会", () => {
  it("済んだ会話があっても、利用者を消せる（会話と中身もカスケードで消える）", async () => {
    const { userId } = await signUpNewUser();
    const { data: p } = await admin.from("projects").insert({ owner_id: userId, name: "退会する人", description: "" }).select("id").single();
    const { data: t } = await admin.from("ai_threads").insert({ owner_id: userId, project_id: p!.id, purpose: "consult" }).select("id").single();
    await admin.from("ai_messages").insert({ thread_id: t!.id, owner_id: userId, role: "user", content: { kind: "text", text: "x" } });
    expect((await admin.from("ai_threads").update({ closed_at: new Date().toISOString(), summary: "まとめ" }).eq("id", t!.id)).error).toBeNull();
    const { error } = await admin.auth.admin.deleteUser(userId);
    expect(error).toBeNull();
    expect((await admin.from("ai_threads").select("id").eq("id", t!.id)).data).toEqual([]);
    expect((await admin.from("ai_messages").select("id").eq("thread_id", t!.id)).data).toEqual([]);
  });
});
