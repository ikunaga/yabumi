// あなたらしさの「投稿に使ってよい」の印（セキュリティ確認 2026-11-06 の APP-L1）: 保存の共通の入口（saveSectionValue）が、AI からの story に
// 必ず mergeStoryShareable をかける。AI と相談の採用（consult.ts の plan_section）も同じ入口を通る。利用者が画面で保存したときは選んだ印のまま
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONSULT_SECTION_KEYS } from "@/lib/ai/consult-schema";
import { saveSectionValue } from "@/lib/plan/save";
import type { PlanData } from "@/lib/plan/schema";
import { deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

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

  it("AI と相談の案は、あなたらしさを出さない（相談の案の形でも断る）", () => {
    expect(CONSULT_SECTION_KEYS).not.toContain("story");
  });
});
