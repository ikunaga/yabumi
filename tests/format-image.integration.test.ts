// 投稿のフォーマットの画像の設定（20261117120000_format_image。docs/design/format-image.md の 5.1）:
// 保存と読み出し・DB の check（形・キー・字数・値）・他人のフォーマットの image を変えられない・ログインしていない人は書けない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runFormatPhotoScene } from "@/lib/ai/photo-gen";
import { scopeAiBudget } from "./helpers/ai-budget";
import { addFormat, getFormat, updateFormat } from "@/lib/post-formats/store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let formatId: string;
const BODY = "連想映画クイズ\n{キーワード}\n答えはリプで";
const series = { slots: { キーワード: "連想できる言葉を 5 つ" }, answer: { name: "映画", instruction: "だれでも知っている映画" } };
const image = { prompt: "{キーワード}を思わせる小物が並ぶ机", scene: "fill", style: "illustration", size: "square", headline: "連想映画クイズ" };

scopeAiBudget();
beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "ねむり日和", product_type: "app" }).select("id").single()).data!.id;
  formatId = await addFormat(alice, projectId, { name: "連想映画クイズ", body: BODY, series, image });
});

afterAll(async () => {
  for (const id of [aliceId, bobId]) await admin.from("ai_usage").delete().eq("owner_id", id);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("フォーマットの画像の設定", () => {
  it("保存して読める。AI の穴を使うので場面は ai にそろう。image を渡さずに直すと画像なしになる", async () => {
    expect((await getFormat(alice, projectId, formatId))?.image).toEqual({ ...image, scene: "ai" });
    await updateFormat(alice, projectId, formatId, { name: "連想映画クイズ", body: BODY, series });
    expect((await getFormat(alice, projectId, formatId))?.image).toBeNull();
    const { data } = await admin.from("post_formats").select("image").eq("id", formatId).single();
    expect(data?.image).toEqual({});
  });

  it("DB の check は形・キー・字数・値を縛る", async () => {
    const set = (v: unknown) => alice.from("post_formats").update({ image: v as never }).eq("id", formatId);
    const ok = { prompt: "机", scene: "ai", style: "photo", size: "auto" };
    for (const bad of [
      [],
      "机",
      { other: 1 },
      { ...ok, other: 1 },
      { ...ok, prompt: "" },
      { ...ok, prompt: " " },
      { ...ok, prompt: "あ".repeat(601) },
      { ...ok, prompt: 1 },
      { scene: "ai", style: "photo", size: "auto" },
      { ...ok, scene: "x" },
      { ...ok, style: "anime" },
      { ...ok, size: "huge" },
      { prompt: "机", style: "photo", size: "auto" },
      { ...ok, headline: "" },
      { ...ok, headline: "あ".repeat(41) },
      { ...ok, headline: 1 },
    ]) {
      expect((await set(bad)).error?.code, JSON.stringify(bad)).toBe("23514");
    }
    expect((await set({ ...ok, headline: null })).error).toBeNull();
    expect((await set({ ...ok, headline: "あ".repeat(40), prompt: "あ".repeat(600) })).error).toBeNull();
    expect((await set({})).error).toBeNull();
  });

  it("他人は読めず、image を変えられない。ログインしていない人も変えられない", async () => {
    await alice.from("post_formats").update({ image: { ...image, scene: "ai" } }).eq("id", formatId);
    expect((await bob.from("post_formats").select("id").eq("id", formatId)).data).toEqual([]);
    const byBob = await bob.from("post_formats").update({ image: {} }).eq("id", formatId).select("id");
    expect(byBob.data ?? []).toEqual([]);
    const byAnon = await anonClient().from("post_formats").update({ image: {} }).eq("id", formatId).select("id");
    expect(byAnon.error ?? byAnon.data?.length === 0).toBeTruthy();
    expect((await getFormat(alice, projectId, formatId))?.image?.prompt).toBe(image.prompt);
  });
});

describe("AI が絵の説明を書く（偽の AI）", () => {
  const fake = () =>
    vi.fn(async () => ({ output: { ideas: [{ title: "机", scene: "古いスクーターの模型と地図が並ぶ机", why: "連想しやすい" }] }, stopReason: "end_turn", model: "claude-opus-5-5", usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 } }));
  const aiImage = { prompt: "{映画}を思わせる{キーワード}が並ぶ机", scene: "ai", style: "illustration", size: "auto", headline: null };

  it("サーバーが読み直したフォーマットの絵の説明に、穴の言葉と答えを入れて送る。本文と知らない穴は送らない", async () => {
    await updateFormat(alice, projectId, formatId, { name: "連想映画クイズ", body: BODY, series, image: aiImage });
    const callIdeas = fake();
    const r = await runFormatPhotoScene(alice, admin, { callIdeas }, { userId: aliceId, projectId, formatId, values: { キーワード: "王女・スクーター", ない穴: "送らない" }, answer: "ローマの休日" });
    expect(r).toEqual({ ok: true, scene: "古いスクーターの模型と地図が並ぶ机" });
    const sent = JSON.stringify(vi.mocked(callIdeas).mock.calls[0]);
    expect(sent).toContain("ローマの休日を思わせる王女・スクーターが並ぶ机");
    expect(sent).not.toContain("送らない");
    expect(sent).not.toContain("答えはリプで");
  });

  it("埋まらない穴があれば呼ばない。そのまま使う設定・他人のフォーマットでも呼ばない", async () => {
    const callIdeas = fake();
    const left = await runFormatPhotoScene(alice, admin, { callIdeas }, { userId: aliceId, projectId, formatId, values: {}, answer: "ローマの休日" });
    expect(left.ok).toBe(false);
    const byBob = await runFormatPhotoScene(bob, admin, { callIdeas }, { userId: bobId, projectId, formatId, values: { キーワード: "a" }, answer: "b" });
    expect(byBob).toEqual({ ok: false, message: expect.stringContaining("見つかりません") });
    await updateFormat(alice, projectId, formatId, { name: "連想映画クイズ", body: "{ひとこと}", image: { ...aiImage, prompt: "{ひとこと}の机", scene: "fill" } });
    const fill = await runFormatPhotoScene(alice, admin, { callIdeas }, { userId: aliceId, projectId, formatId, values: { ひとこと: "a" }, answer: "" });
    expect(fill.ok).toBe(false);
    expect(callIdeas).not.toHaveBeenCalled();
  });
});
