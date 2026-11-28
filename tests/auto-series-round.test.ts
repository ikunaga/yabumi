// 自動投稿のシリーズの次の回の案を、使える案が出るまで作り直す（src/lib/auto-post/series-round.ts。2026-11-28 本番で 1 回で諦めて回を飛ばした）。
// 偽の返事で、別のモデルに回った返事・拒否・途中で切れた返事・形の違う返事・前の回と同じ案を 1 回目に返し、2 回目で作れることと、
// 最後まで駄目なら理由つきで飛ばすこと、時間の上限で新しく呼ばないことを確かめる
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { CallFormatRound } from "@/lib/ai/format-round-ai";
import { AiBudgetDenied } from "@/lib/ai/budget";
import { normalizePlan } from "@/lib/plan/schema";
import { usedRoundKeys } from "@/lib/post-formats/series";
import { proposeRound, SERIES_ROUND_ATTEMPTS, SERIES_ROUND_BUDGET_MS } from "@/lib/auto-post/series-round";

const series = {
  vars: [
    { name: "映画", mode: "ai" as const, instruction: "映画が好きな人は知っている作品", unique: true },
    { name: "キーワード5つ", mode: "ai" as const, instruction: "上の映画を連想できる言葉を 5 つ。・でつなぐ", unique: false },
  ],
};
const format = { name: "連想映画クイズ", body: "この画像から連想される映画は？\n【{キーワード5つ}】", series, image: null };
const rounds = [{ values: { 映画: "ガタカ", キーワード5つ: "遺伝子・宇宙・なりすまし・皮膚・遠泳" } }];
const input = { project: { name: "映画の話", description: null, targetAudience: null, productType: null }, plan: normalizePlan(undefined, ""), format, rounds, fixed: {}, used: usedRoundKeys(series, rounds) };

const usage = { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 };
const good = { output: { proposals: [{ values: [{ name: "映画", text: "インセプション" }, { name: "キーワード5つ", text: "夢・回るこま・階層・雪山・列車" }], checks: [] }] }, stopReason: "end_turn", model: "claude-opus-5-5", usage };
const reply = (r: { output: unknown; stopReason: string | null; model?: string }) => ({ model: "claude-opus-5-5", usage, ...r }) as Awaited<ReturnType<CallFormatRound>>;
const sent = (call: ReturnType<typeof vi.fn>, n: number) => JSON.stringify((call.mock.calls[n][0] as { messages: unknown }).messages);

describe("proposeRound", () => {
  it("1 回目で使える案が出たら、それだけ呼ぶ", async () => {
    const call = vi.fn<CallFormatRound>(async () => good);
    const r = await proposeRound(input, call);
    expect(r).toMatchObject({ ok: true, proposal: { values: { 映画: "インセプション" } } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(sent(call, 0)).not.toContain("作り直し");
  });

  it.each([
    ["拒否（refusal）", reply({ output: null, stopReason: "refusal" })],
    ["別のモデルに回って、返事が読めない", reply({ output: null, stopReason: "end_turn", model: "claude-sonnet-5-5" })],
    ["途中で切れた（max_tokens）", reply({ output: null, stopReason: "max_tokens" })],
    ["形が違う", reply({ output: { proposals: "x" }, stopReason: "end_turn" })],
  ])("1 回目が「%s」でも、2 回目で作れる", async (_, first) => {
    const call = vi.fn<CallFormatRound>().mockResolvedValueOnce(first as never).mockResolvedValueOnce(good);
    const r = await proposeRound(input, call);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, proposal: { values: { 映画: "インセプション" } } });
    expect(call).toHaveBeenCalledTimes(2);
    expect(sent(call, 1)).toContain("前の返事で使えなかったもの");
  });

  it("別のモデルに回っても、形が正しく読めた案は使う（end_turn でなくても）", async () => {
    const call = vi.fn<CallFormatRound>(async () => ({ ...good, stopReason: "max_tokens", model: "claude-sonnet-5-5" }));
    expect(await proposeRound(input, call)).toMatchObject({ ok: true });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("前の回と同じ案・言葉の数が違う案は、理由と案の言葉を伝えて作り直す", async () => {
    const bad = reply({
      output: {
        proposals: [
          { values: [{ name: "映画", text: "ガタカ" }, { name: "キーワード5つ", text: "a・b・c・d・e" }], checks: [] },
          { values: [{ name: "映画", text: "トゥルーマン・ショー" }, { name: "キーワード5つ", text: "生中継・セットの町・隠しカメラ・保険会社・空の壁・海" }], checks: [] },
        ],
      },
      stopReason: "end_turn",
    });
    const call = vi.fn<CallFormatRound>().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    const r = await proposeRound(input, call);
    expect(r.ok).toBe(true);
    expect(r.attempts[0].dropped).toEqual({ dup_past: 1, count: 1 });
    const note = sent(call, 1);
    expect(note).toContain("「ガタカ」は、もう出した回と重なります");
    expect(note).toContain("「トゥルーマン・ショー」の {キーワード5つ} は、「・」で区切ると 6 個でした。ちょうど 5 個にし");
  });

  it(`${SERIES_ROUND_ATTEMPTS} 回とも駄目なら、試した回数・止まった理由・モデル・捨てた理由・秒数を残して飛ばす`, async () => {
    const call = vi
      .fn<CallFormatRound>()
      .mockResolvedValueOnce(reply({ output: null, stopReason: "refusal" }))
      .mockResolvedValueOnce(reply({ output: null, stopReason: "max_tokens", model: "claude-sonnet-5-5" }))
      .mockResolvedValueOnce(reply({ output: { proposals: [{ values: [{ name: "映画", text: "ガタカ" }, { name: "キーワード5つ", text: "a・b・c・d・e" }], checks: [] }] }, stopReason: "end_turn" }));
    const r = await proposeRound(input, call);
    expect(call).toHaveBeenCalledTimes(SERIES_ROUND_ATTEMPTS);
    if (r.ok) throw new Error("作れてしまった");
    expect(r.detail).toMatch(/^前と重ならない次の投稿の案を出せませんでした。3 回: refusal opus-5-5 \d+ 秒 \/ max_tokens 返事なし sonnet-5-5 \d+ 秒 \/ end_turn opus-5-5 前と同じ1 \d+ 秒$/);
    // DB の reason_detail は 200 字まで
    expect([...r.detail].length).toBeLessThanOrEqual(200);
    // 本文（案の言葉）は残さない
    expect(r.detail).not.toContain("ガタカ");
  });

  it(`時間の上限（${SERIES_ROUND_BUDGET_MS / 1000} 秒）の内でしか、新しく呼ばない`, async () => {
    let t = 0;
    const call = vi.fn<CallFormatRound>(async () => {
      t += 40_000;
      return reply({ output: null, stopReason: "refusal" });
    });
    const r = await proposeRound(input, call, { now: () => t });
    // 1 回目で 40 秒、残り 35 秒は 30 秒より多いので 2 回目を呼ぶ。2 回目のあとは残りが足りないので呼ばない
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    expect(t).toBeLessThanOrEqual(SERIES_ROUND_BUDGET_MS + 40_000);
  });

  it("呼び出しが失敗しても作り直す。全部が失敗なら、前と同じく投げる（ジョブが回を作れなかったにしてやり直す）", async () => {
    const once = vi.fn<CallFormatRound>().mockRejectedValueOnce(new Error("overloaded")).mockResolvedValueOnce(good);
    expect(await proposeRound(input, once)).toMatchObject({ ok: true });
    const always = vi.fn<CallFormatRound>(async () => {
      throw new Error("overloaded");
    });
    await expect(proposeRound(input, always)).rejects.toThrow("overloaded");
    expect(always).toHaveBeenCalledTimes(SERIES_ROUND_ATTEMPTS);
  });

  it("AI の枠で断られたら、作り直さずにそのまま投げる", async () => {
    const call = vi.fn<CallFormatRound>(async () => {
      throw new AiBudgetDenied("上限");
    });
    await expect(proposeRound(input, call)).rejects.toBeInstanceOf(AiBudgetDenied);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
