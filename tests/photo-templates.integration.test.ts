// 絵の説明のフォーマット（20261107120000_photo_prompt_templates）: 本人だけが読み書きできる・20 個まで（同時でも）・いつも使うは 1 つ・
// 別のプロジェクトへ動かせない・AI の案に選んだフォーマットだけを渡す。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runPhotoIdeas } from "@/lib/ai/photo-gen";
import { MAX_PHOTO_TEMPLATES, MAX_PHOTO_TEMPLATES_PER_USER } from "@/lib/photo-templates/schema";
import { TemplateError, addTemplate, deleteTemplate, listTemplates, setDefaultTemplate, updateTemplate } from "@/lib/photo-templates/store";
import { scopeAiBudget } from "./helpers/ai-budget";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let p1: string;
let p2: string;
let bobProject: string;
const t = (name: string) => ({ name, body: `{場面}。${name}の光` });

scopeAiBudget();
beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  p1 = (await alice.from("projects").insert({ name: "こむぎ日和", product_type: "shop" }).select("id").single()).data!.id;
  p2 = (await alice.from("projects").insert({ name: "別のお店", product_type: "shop" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "ことばの教室" }).select("id").single()).data!.id;
});
afterAll(async () => {
  for (const id of [aliceId, bobId]) await admin.from("ai_usage").delete().eq("owner_id", id);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("絵の説明のフォーマット", () => {
  let a: string;

  it("本人は足して読めて、名前と本文を直せる。並びは足した順", async () => {
    a = await addTemplate(alice, p1, t("朝"));
    await addTemplate(alice, p1, t("夜"));
    await updateTemplate(alice, p1, a, { name: "朝の店先", body: "{場面}。朝の光" });
    expect((await listTemplates(alice, p1)).map((x) => x.name)).toEqual(["朝の店先", "夜"]);
  });

  it("他人とログインしていない人は読めず、書けない。他人のプロジェクトにも足せない", async () => {
    expect((await bob.from("photo_prompt_templates").select("id").eq("project_id", p1)).data).toEqual([]);
    expect((await anonClient().from("photo_prompt_templates").select("id").limit(1)).data ?? []).toEqual([]);
    expect((await bob.from("photo_prompt_templates").update({ name: "x" }).eq("id", a).select("id")).data).toEqual([]);
    expect((await bob.from("photo_prompt_templates").delete().eq("id", a).select("id")).data).toEqual([]);
    expect((await bob.from("photo_prompt_templates").insert({ project_id: p1, name: "x", body: "y" })).error).not.toBeNull();
    expect((await bob.from("photo_prompt_templates").insert({ project_id: bobProject, owner_id: aliceId, name: "x", body: "y" })).error).not.toBeNull();
    await expect(updateTemplate(bob, p1, a, { name: "x", body: "y" })).rejects.toBeInstanceOf(TemplateError);
    expect((await listTemplates(alice, p1))[0].name).toBe("朝の店先");
  });

  it("別のプロジェクトへ動かせず、持ち主も変えられない（列の権限）", async () => {
    expect((await alice.from("photo_prompt_templates").update({ project_id: p2 } as never).eq("id", a)).error?.code).toBe("42501");
    expect((await alice.from("photo_prompt_templates").update({ owner_id: bobId } as never).eq("id", a)).error?.code).toBe("42501");
  });

  it("名前・本文の長さは DB でも縛る", async () => {
    expect((await alice.from("photo_prompt_templates").insert({ project_id: p1, name: "あ".repeat(41), body: "y" })).error?.code).toBe("23514");
    expect((await alice.from("photo_prompt_templates").insert({ project_id: p1, name: " ", body: "y" })).error?.code).toBe("23514");
    expect((await alice.from("photo_prompt_templates").insert({ project_id: p1, name: "x", body: "あ".repeat(601) })).error?.code).toBe("23514");
  });

  it("「いつも使う」は 1 つだけ。付け替えると前は外れる。外すこともできる", async () => {
    const list = await listTemplates(alice, p1);
    await setDefaultTemplate(alice, p1, list[0].id);
    await setDefaultTemplate(alice, p1, list[1].id);
    expect((await listTemplates(alice, p1)).map((x) => x.isDefault)).toEqual([false, true]);
    // DB でも 2 つにはできない
    expect((await alice.from("photo_prompt_templates").update({ is_default: true }).eq("id", list[0].id)).error?.code).toBe("23505");
    await setDefaultTemplate(alice, p1, null);
    expect((await listTemplates(alice, p1)).some((x) => x.isDefault)).toBe(false);
  });

  it(`1 つのプロジェクトに ${MAX_PHOTO_TEMPLATES} 個まで。同時に足しても超えない`, async () => {
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => addTemplate(alice, p2, t(`同時 ${i}`))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_PHOTO_TEMPLATES);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected[0].reason).toBeInstanceOf(TemplateError);
    expect((rejected[0].reason as TemplateError).userMessage).toContain(`${MAX_PHOTO_TEMPLATES} 個まで`);
    const { count } = await admin.from("photo_prompt_templates").select("id", { count: "exact", head: true }).eq("project_id", p2);
    expect(count).toBe(MAX_PHOTO_TEMPLATES);
    // 消すと、また足せる
    const first = (await listTemplates(alice, p2))[0];
    await deleteTemplate(alice, p2, first.id);
    await expect(addTemplate(alice, p2, t("空いた分"))).resolves.toBeTruthy();
  });

  it("絵の説明の案には、選んだフォーマット（本人の、このプロジェクトのもの）だけを渡す。他人のものは断り、AI を呼ばない", async () => {
    const id = (await listTemplates(alice, p1))[0].id;
    // 呼び出しごとに別の偽物を作る（同じ偽物を包むと、呼ばれた記録が混ざる）
    const fake = () => vi.fn(async () => ({ output: { ideas: [{ title: "朝", scene: "焼きたてのパンが並んだカウンター", why: "朝の空気が伝わる" }] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 } }));
    const callIdeas = fake();
    const ok = await runPhotoIdeas(alice, admin, { callIdeas }, { userId: aliceId, projectId: p1, text: "金曜だけのカンパーニュ", templateId: id });
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(vi.mocked(callIdeas).mock.calls[0])).toContain("朝の光");
    const none = fake();
    await runPhotoIdeas(alice, admin, { callIdeas: none }, { userId: aliceId, projectId: p1, text: "本文", templateId: null });
    expect(JSON.stringify((vi.mocked(none).mock.calls[0] as unknown as [{ messages: unknown }])[0].messages)).not.toContain("# 絵の説明のフォーマット");
    const other = fake();
    const r = await runPhotoIdeas(bob, admin, { callIdeas: other }, { userId: bobId, projectId: bobProject, text: "本文", templateId: id });
    expect(r).toMatchObject({ ok: false });
    expect(other).not.toHaveBeenCalled();
  });

  it(`1 人の合計は ${MAX_PHOTO_TEMPLATES_PER_USER} 個まで（プロジェクトを増やしてもすり抜けられない。同時でも）`, async () => {
    const { userId: carolId, client: carol } = await signUpNewUser();
    try {
      const projects: string[] = [];
      for (let i = 0; i < 6; i++) projects.push((await carol.from("projects").insert({ name: `お店 ${i}` }).select("id").single()).data!.id);
      // 5 つのプロジェクトに 20 個ずつ（合計 100）
      for (const p of projects.slice(0, 5)) {
        const { error } = await carol.from("photo_prompt_templates").insert(Array.from({ length: 20 }, (_, i) => ({ project_id: p, name: `f${i}`, body: "{場面}。光" })));
        expect(error).toBeNull();
      }
      // 6 つ目のプロジェクトには、同時に足しても 1 つも入らない
      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => addTemplate(carol, projects[5], t(`越え ${i}`))));
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      expect(((results[0] as PromiseRejectedResult).reason as TemplateError).userMessage).toContain(`1 人 ${MAX_PHOTO_TEMPLATES_PER_USER} 個まで`);
      expect((await admin.from("photo_prompt_templates").select("id", { count: "exact", head: true }).eq("owner_id", carolId)).count).toBe(MAX_PHOTO_TEMPLATES_PER_USER);
    } finally {
      await deleteUser(carolId);
    }
  });

  it("プロジェクトを消すとフォーマットも消える", async () => {
    await alice.from("projects").delete().eq("id", p2);
    expect((await admin.from("photo_prompt_templates").select("id", { count: "exact", head: true }).eq("project_id", p2)).count).toBe(0);
  });
});
