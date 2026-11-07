// あなたらしさの「投稿に使ってよい」の印（セキュリティ確認 2026-11-06 の APP-L1）: 保存の共通の入口（saveSectionValue）が、AI からの story に
// 必ず mergeStoryShareable をかける。AI と相談の採用（consult.ts の plan_section）も同じ入口を通る。利用者が画面で保存したときは選んだ印のまま
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONSULT_SECTION_KEYS } from "@/lib/ai/consult-schema";
import { saveSectionValue } from "@/lib/plan/save";
import type { PlanData } from "@/lib/plan/schema";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();

let alice: TestClient;
let aliceId: string;
let projectId: string;

const item = (text: string, shareable = true) => ({ text, shareable });
const story = (s: Partial<PlanData["story"]>): PlanData["story"] => ({ why: item(""), background: item(""), struggle: item(""), strength: item(""), summary: item(""), ...s });
const saved = async () => (((await alice.from("account_plans").select("data").eq("project_id", projectId).single()).data!.data) as { story: PlanData["story"] }).story;
const flags = (s: PlanData["story"]) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.shareable]));

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "器の店", description: "器", target_audience: "30 代" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
});

describe("保存の共通の入口", () => {
  it("利用者が画面で保存したときは、選んだ印のまま", async () => {
    expect((await saveSectionValue(alice, projectId, "story", story({ why: item("器が好き"), background: item("病気で辞めた", false), summary: item("辞めて店を始めた") }), "manual")).ok).toBe(true);
    expect(flags(await saved())).toEqual({ why: true, background: false, struggle: true, strength: true, summary: true });
  });

  it("AI からの story は、保存してある「投稿に使わない」を残し、新しい強み・短いストーリーの文をオフにする（相棒・相談のどちらの採用もこの入口）", async () => {
    // AI の案は印を全部オンで送ってきた
    const fromAi = story({ why: item("器が好き"), background: item("病気で辞めた"), strength: item("器を見る目"), summary: item("病気で辞めて店を始めた話") });
    expect((await saveSectionValue(alice, projectId, "story", fromAi, "ai")).ok).toBe(true);
    expect(flags(await saved())).toEqual({ why: true, background: false, struggle: true, strength: false, summary: false });
  });

  it("利用者が確かめてオンにした文は、同じ文の案をもう一度採用しても、オンのまま", async () => {
    const checked = { ...(await saved()), strength: item("器を見る目"), summary: item("病気で辞めて店を始めた話") };
    await saveSectionValue(alice, projectId, "story", checked, "manual");
    await saveSectionValue(alice, projectId, "story", story({ why: item("器が好き"), background: item("病気で辞めた"), strength: item("器を見る目"), summary: item("病気で辞めて店を始めた話") }), "ai");
    expect(flags(await saved())).toEqual({ why: true, background: false, struggle: true, strength: true, summary: true });
  });

  it("AI の案がオフの項目を空にして送ってきても、保存してある前の値のオフを材料に数え、新しい強み・短いストーリーはオフ", async () => {
    await saveSectionValue(alice, projectId, "story", story({ why: item("器が好き"), background: item("病気で辞めた", false) }), "manual");
    const fromAi = story({ why: item("器が好き"), background: item(""), strength: item("休んだ時間で育った目"), summary: item("休んでから器の店を始めた話") });
    expect((await saveSectionValue(alice, projectId, "story", fromAi, "ai")).ok).toBe(true);
    const s = await saved();
    expect([s.background.shareable, s.strength.shareable, s.summary.shareable]).toEqual([false, false, false]);
  });

  it("前の形（文字列だけ・項目が欠けている・形に合わない項目がある）で保存してあっても、オフの印は残る", async () => {
    // 前の版の書き方を再現する（思いは文字列だけ、背景はオフ、悩み・強みはない、短いストーリーは長すぎて形に合わない）
    const { error } = await admin
      .from("account_plans")
      .update({ data: { story: { why: "器が好き", background: { text: "病気で辞めた", shareable: false }, summary: { text: "あ".repeat(400), shareable: true } } } as never })
      .eq("project_id", projectId);
    expect(error).toBeNull();
    const fromAi = story({ why: item("器が好き"), background: item("病気で辞めた"), summary: item("新しいまとめ") });
    expect((await saveSectionValue(alice, projectId, "story", fromAi, "ai")).ok).toBe(true);
    const s = await saved();
    expect([s.why.shareable, s.background.shareable, s.summary.shareable]).toEqual([true, false, false]);
  });

  it("保存してある値を読めなかったら、保存しない（前の印がない扱いにしてオフを消さない）", async () => {
    const rpc = vi.fn();
    const broken = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }),
      rpc,
    } as unknown as TestClient;
    await expect(saveSectionValue(broken, projectId, "story", story({ summary: item("x") }), "ai")).rejects.toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("AI が文を変えたオンの項目の確かめの印は保存され、利用者が画面で保存すると消える", async () => {
    await saveSectionValue(alice, projectId, "story", story({ why: item("器が好き"), background: item("病気で辞めた", false) }), "manual");
    await saveSectionValue(alice, projectId, "story", story({ why: item("病気で仕事を辞めたのがきっかけ"), background: item("病気で辞めた") }), "ai");
    expect((await saved()).why).toEqual({ text: "病気で仕事を辞めたのがきっかけ", shareable: true, check: true });
    // 画面の保存は、確かめの印を送らない（parseSectionForm）
    await saveSectionValue(alice, projectId, "story", story({ why: item("病気で仕事を辞めたのがきっかけ"), background: item("病気で辞めた", false) }), "manual");
    expect((await saved()).why).toEqual({ text: "病気で仕事を辞めたのがきっかけ", shareable: true });
  });

  it("AI と相談の案は、あなたらしさを出さない（相談の案の形でも断る）", () => {
    expect(CONSULT_SECTION_KEYS).not.toContain("story");
  });
});
