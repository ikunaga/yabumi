// シリーズ投稿（20261113140000_format_series。docs/design/format-series.md）: 設定の保存・記録の RLS と列の権限・結びつけ（付け替えない）・
// 300 回と 3,000 回・リセットで消す・貼る・次の回の案の流れ（偽の AI）・1 日 20 回。本物の AI は呼ばない
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runFormatRound, type CallFormatRound } from "@/lib/ai/format-round-ai";
import { addFormat, getFormat } from "@/lib/post-formats/store";
import { addRound, attachRounds, discardRounds, listRounds, pasteRounds } from "@/lib/post-formats/rounds";
import { SERIES_DAILY_RUNS } from "@/lib/post-formats/series";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;
let formatId: string;
const BODY = "連想映画クイズ\n{キーワード}\nこの 5 つから連想する映画は？答えはリプで";
const series = { slots: { キーワード: "答えの映画を連想できる言葉を 5 つ", ない穴: "捨てる" }, answer: { name: "映画", instruction: "だれでも知っている映画を 1 つ" } };

const newPost = async (client: TestClient, project: string) =>
  (await client.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: project, p_body: "本文", p_planned_at: null as unknown as string, p_status: "draft", p_targets: [] })).data!;

scopeAiBudget();
beforeEach(async () => {
  if (aliceId) await admin.from("ai_usage").delete().eq("owner_id", aliceId);
});

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "ねむり日和", product_type: "app" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "ほかの人" }).select("id").single()).data!.id;
  formatId = await addFormat(alice, projectId, { name: "連想映画クイズ", body: BODY, series });
});

afterAll(async () => {
  for (const id of [aliceId, bobId]) await admin.from("ai_usage").delete().eq("owner_id", id);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("フォーマットのシリーズの設定", () => {
  it("保存のときに、型の文にない穴の指示を捨てる。DB の check は形と字数を縛る", async () => {
    expect((await getFormat(alice, projectId, formatId))?.series).toEqual({ slots: { キーワード: "答えの映画を連想できる言葉を 5 つ" }, answer: { name: "映画", instruction: "だれでも知っている映画を 1 つ" } });
    const set = (v: unknown) => alice.from("post_formats").update({ series: v as never }).eq("id", formatId);
    for (const bad of [[], { other: 1 }, { slots: { キーワード: 1 } }, { slots: { キーワード: "あ".repeat(61) } }, { slots: { ["あ".repeat(13)]: "" } }, { answer: { name: "", instruction: "" } }, { answer: { name: "映画" } }, { answer: { instruction: "有名な映画" } }, { answer: { name: 1, instruction: "" } }]) {
      expect((await set(bad)).error?.code, JSON.stringify(bad)).toBe("23514");
    }
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`穴${i}`, ""]));
    expect((await set({ slots: nine })).error?.code).toBe("23514");
    expect((await set({ answer: null, slots: { キーワード: "" } })).error).toBeNull();
    // ほかのテストのために、もとの設定に戻す
    expect((await set({ slots: { キーワード: "答えの映画を連想できる言葉を 5 つ" }, answer: series.answer })).error).toBeNull();
  });
});

describe("シリーズの記録の権限", () => {
  it("本人だけが読み書きできる。他人の owner_id・他人のフォーマットでは作れず、ログインしていない人は読めない", async () => {
    const id = await addRound(alice, projectId, formatId, { answer: "バック・トゥ・ザ・フューチャー", values: { キーワード: "時計台・稲妻" }, source: "ai" });
    expect(id).toBeTruthy();
    expect((await bob.from("post_format_rounds").select("id").eq("id", id!)).data).toEqual([]);
    expect((await anonClient().from("post_format_rounds").select("id").limit(1)).data ?? []).toEqual([]);
    expect((await bob.from("post_format_rounds").insert({ format_id: formatId, answer: "x", source: "hand" })).error).not.toBeNull();
    const bobFormat = await addFormat(bob, bobProject, { name: "ほかの型", body: "{何か}", series: { slots: { 何か: "" } } });
    expect((await bob.from("post_format_rounds").insert({ format_id: bobFormat, owner_id: aliceId, answer: "x", source: "hand" })).error).not.toBeNull();
    expect((await alice.from("post_format_rounds").insert({ format_id: formatId, answer: "x", source: "hand", post_id: await newPost(alice, projectId) } as never)).error).not.toBeNull();
    expect((await bob.from("post_format_rounds").delete().eq("id", id!).select("id")).data).toEqual([]);
    // 答えも穴の言葉も空の記録は作らない
    expect((await alice.from("post_format_rounds").insert({ format_id: formatId, answer: "", values: {}, source: "hand" })).error?.code).toBe("23514");
  });

  it("自分の投稿にだけ結びつけられ、一度結びつけたら付け替えない。リセットでは、まだ結びついていない記録だけ消す", async () => {
    const a = (await addRound(alice, projectId, formatId, { answer: "ジュラシック・パーク", values: {}, source: "ai" }))!;
    const b = (await addRound(alice, projectId, formatId, { answer: "タイタニック", values: {}, source: "hand" }))!;
    const bobPost = await newPost(bob, bobProject);
    expect((await alice.from("post_format_rounds").update({ post_id: bobPost }).eq("id", a)).error).not.toBeNull();
    const post1 = await newPost(alice, projectId);
    const post2 = await newPost(alice, projectId);
    await attachRounds(alice, [a], post1);
    await attachRounds(alice, [a], post2);
    expect((await admin.from("post_format_rounds").select("post_id").eq("id", a).single()).data!.post_id).toBe(post1);
    expect((await alice.from("post_format_rounds").update({ post_id: post2 }).eq("id", a).select("id")).data).toEqual([]);
    await discardRounds(alice, [a, b]);
    expect((await admin.from("post_format_rounds").select("id").in("id", [a, b])).data!.map((r) => r.id)).toEqual([a]);
    // 投稿を消しても記録は残る（もう出した回）
    await alice.from("posts").delete().eq("id", post1);
    expect((await admin.from("post_format_rounds").select("post_id").eq("id", a).single()).data!.post_id).toBeNull();
  });

  it("シリーズでないフォーマットには記録を付けない", async () => {
    const plain = await addFormat(alice, projectId, { name: "ふつうの型", body: "{何か}" });
    expect(await addRound(alice, projectId, plain, { answer: "x", values: {}, source: "hand" })).toBeNull();
  });
});

describe("これまでの回を貼る・上限", () => {
  it("同じ答えは足さず、1 つのフォーマットに 300 回まで（同時に足しても超えない）", async () => {
    const f = await addFormat(alice, projectId, { name: "300 回", body: BODY, series: { slots: { キーワード: "" } } });
    const first = await pasteRounds(alice, projectId, f, "映画 A\n映画 A\n映画 B");
    expect(first).toEqual({ added: 2, skipped: 1, overflow: 0 });
    const rows = Array.from({ length: 297 }, (_, i) => ({ format_id: f, owner_id: aliceId, answer: `大量 ${i}`, source: "pasted" }));
    expect((await admin.from("post_format_rounds").insert(rows)).error).toBeNull();
    const last = await Promise.allSettled([addRound(alice, projectId, f, { answer: "最後", values: {}, source: "hand" }), addRound(alice, projectId, f, { answer: "あふれ", values: {}, source: "hand" })]);
    expect(last.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(last.find((r) => r.status === "rejected")).toMatchObject({ reason: { userMessage: expect.stringContaining("300 回まで") } });
    expect((await listRounds(alice, f)).length).toBe(300);
    expect((await pasteRounds(alice, projectId, f, "もう入らない")).overflow).toBe(1);
  });

  it("1 人の合計は 3,000 回まで", async () => {
    const formats: string[] = [];
    for (let i = 0; i < 10; i++) formats.push(await addFormat(alice, projectId, { name: `合計 ${i}`, body: BODY, series: { slots: { キーワード: "" } } }));
    const already = (await admin.from("post_format_rounds").select("id", { count: "exact", head: true }).eq("owner_id", aliceId)).count ?? 0;
    let left = 3000 - already;
    for (const f of formats) {
      const n = Math.min(left, 299);
      if (n <= 0) break;
      expect((await admin.from("post_format_rounds").insert(Array.from({ length: n }, (_, i) => ({ format_id: f, owner_id: aliceId, answer: `合計 ${i}`, source: "pasted" })))).error).toBeNull();
      left -= n;
    }
    expect(left).toBe(0);
    await expect(addRound(alice, projectId, formats[9], { answer: "3001 回目", values: {}, source: "hand" })).rejects.toMatchObject({ userMessage: expect.stringContaining("1 人 3,000 回まで") });
    for (const f of formats) await alice.from("post_formats").delete().eq("id", f);
  });
});

describe("次の回の案（偽の AI）", () => {
  const usage = { inputTokens: 4000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 800 };
  const caller = (output: unknown): CallFormatRound => vi.fn(async () => ({ output, stopReason: "end_turn", model: "claude-opus-5-5", usage }));

  it("もう出した回を送り、重なる案を捨てて返す。利用量を post_format_round として記録する", async () => {
    const call = caller({
      proposals: [
        { answer: "バック・トゥ・ザ・フューチャー", slots: [{ slot: "キーワード", text: "時計台・稲妻" }], checks: ["時計台の場面は第 1 作にあります"] },
        { answer: "ローマの休日", slots: [{ slot: "キーワード", text: "スクーター・真実の口" }], checks: [] },
      ],
    });
    const r = await runFormatRound(alice, admin, { callFormatRound: call }, { userId: aliceId, projectId, formatId, wish: "古い映画で" });
    expect(r).toEqual({ ok: true, proposals: [{ answer: "ローマの休日", values: { キーワード: "スクーター・真実の口" }, checks: [] }] });
    const sent = JSON.stringify(vi.mocked(call).mock.calls[0][0].messages);
    expect(sent).toContain("バック・トゥ・ザ・フューチャー");
    expect(sent).toContain("古い映画で");
    expect((await admin.from("ai_usage").select("purpose").eq("owner_id", aliceId)).data).toEqual([{ purpose: "post_format_round" }]);
  });

  it(`1 日 ${SERIES_DAILY_RUNS} 回まで。シリーズでないフォーマット・他人のフォーマットは断る`, async () => {
    await admin.from("ai_usage").insert(Array.from({ length: SERIES_DAILY_RUNS }, () => ({ owner_id: aliceId, purpose: "post_format_round", model: "claude-opus-5-5", cost_usd: 0.001, status: "done" })));
    const call = caller({ proposals: [] });
    expect(await runFormatRound(alice, admin, { callFormatRound: call }, { userId: aliceId, projectId, formatId })).toEqual({ ok: false, message: `次の回の案は、1 日 ${SERIES_DAILY_RUNS} 回までです。明日またお試しください。` });
    expect(call).not.toHaveBeenCalled();
    await admin.from("ai_usage").delete().eq("owner_id", aliceId);
    const plain = await addFormat(alice, projectId, { name: "ふつうの型 2", body: "{何か}" });
    expect((await runFormatRound(alice, admin, { callFormatRound: call }, { userId: aliceId, projectId, formatId: plain })).ok).toBe(false);
    expect((await runFormatRound(bob, admin, { callFormatRound: call }, { userId: bobId, projectId, formatId })).ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});
