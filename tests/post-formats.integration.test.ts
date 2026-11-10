// 投稿のフォーマット（20261110120000_post_formats）: 本人だけが読み書きできる・別のプロジェクトへ動かせない・字数と穴の数を DB でも縛る・
// 1 つのプロジェクトに 20 個・1 人 100 個まで（同時でも）・プロジェクトを消すと消える
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_POST_FORMATS, MAX_POST_FORMATS_PER_USER } from "@/lib/post-formats/schema";
import { FormatError, addFormat, deleteFormat, getFormat, listFormats, updateFormat } from "@/lib/post-formats/store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let p1: string;
let p2: string;
let bobProject: string;
const f = (name: string) => ({ name, body: `{何が}。${name}` });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  p1 = (await alice.from("projects").insert({ name: "こむぎ日和", product_type: "shop" }).select("id").single()).data!.id;
  p2 = (await alice.from("projects").insert({ name: "別のお店", product_type: "shop" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "ことばの教室" }).select("id").single()).data!.id;
});
afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("投稿のフォーマット", () => {
  let a: string;

  it("本人は足して読めて、直せる。並びは足した順。入力は整えてから保存する", async () => {
    a = await addFormat(alice, p1, { name: " 新メニュー ", purpose: "新しいものを出すとき", body: "【新メニュー】{何が}\r\n{いつから}から", example: "", pillar: "新メニュー" });
    await addFormat(alice, p1, f("今日のお店"));
    await updateFormat(alice, p1, a, { name: "新メニューのお知らせ", purpose: "", body: "{何が}を{いつから}", example: "栗のタルトを 11 月 15 日から", pillar: "" });
    expect((await listFormats(alice, p1)).map((x) => x.name)).toEqual(["新メニューのお知らせ", "今日のお店"]);
    expect(await getFormat(alice, p1, a)).toMatchObject({ body: "{何が}を{いつから}", example: "栗のタルトを 11 月 15 日から", pillar: "" });
    const b = await getFormat(alice, p1, (await listFormats(alice, p1))[1].id);
    expect(b).toMatchObject({ purpose: "", example: "", pillar: "" });
  });

  it("穴の決まり（8 種類・名前 12 字・空の {}）に合わないものは、保存の前に断る", async () => {
    await expect(addFormat(alice, p1, { name: "x", body: Array.from({ length: 9 }, (_, i) => `{穴${i}}`).join("") })).rejects.toBeInstanceOf(FormatError);
    await expect(addFormat(alice, p1, { name: "x", body: "{あいうえおかきくけこさしす}" })).rejects.toThrow(/12 字/);
    await expect(addFormat(alice, p1, { name: "x", body: "{ }です" })).rejects.toThrow(/穴の名前/);
  });

  it("他人とログインしていない人は読めず、書けない。他人のプロジェクトにも足せない", async () => {
    expect((await bob.from("post_formats").select("id").eq("project_id", p1)).data).toEqual([]);
    expect((await anonClient().from("post_formats").select("id").limit(1)).data ?? []).toEqual([]);
    expect((await bob.from("post_formats").update({ name: "x" }).eq("id", a).select("id")).data).toEqual([]);
    expect((await bob.from("post_formats").delete().eq("id", a).select("id")).data).toEqual([]);
    expect((await bob.from("post_formats").insert({ project_id: p1, name: "x", body: "y" })).error).not.toBeNull();
    expect((await bob.from("post_formats").insert({ project_id: bobProject, owner_id: aliceId, name: "x", body: "y" })).error).not.toBeNull();
    await expect(updateFormat(bob, p1, a, f("x"))).rejects.toBeInstanceOf(FormatError);
    await expect(deleteFormat(bob, p1, a)).rejects.toBeInstanceOf(FormatError);
    expect(await getFormat(bob, p1, a)).toBeNull();
    expect((await listFormats(alice, p1))[0].name).toBe("新メニューのお知らせ");
  });

  it("別のプロジェクトへ動かせず、持ち主も変えられない（列の権限）", async () => {
    expect((await alice.from("post_formats").update({ project_id: p2 } as never).eq("id", a)).error?.code).toBe("42501");
    expect((await alice.from("post_formats").update({ owner_id: bobId } as never).eq("id", a)).error?.code).toBe("42501");
  });

  it("字数と穴の数は DB でも縛る", async () => {
    const ins = (v: Record<string, string>) => alice.from("post_formats").insert({ project_id: p1, name: "x", body: "y", ...v });
    expect((await ins({ name: "あ".repeat(41) })).error?.code).toBe("23514");
    expect((await ins({ name: " " })).error?.code).toBe("23514");
    expect((await ins({ body: "あ".repeat(601) })).error?.code).toBe("23514");
    expect((await ins({ purpose: "あ".repeat(101) })).error?.code).toBe("23514");
    expect((await ins({ example: "あ".repeat(601) })).error?.code).toBe("23514");
    expect((await ins({ pillar: "あ".repeat(51) })).error?.code).toBe("23514");
    expect((await ins({ body: "{a}".repeat(17) })).error?.code).toBe("23514");
  });

  it(`1 つのプロジェクトに ${MAX_POST_FORMATS} 個まで。同時に足しても超えない`, async () => {
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => addFormat(alice, p2, f(`同時 ${i}`))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_POST_FORMATS);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect((rejected[0].reason as FormatError).userMessage).toContain(`${MAX_POST_FORMATS} 個まで`);
    expect((await admin.from("post_formats").select("id", { count: "exact", head: true }).eq("project_id", p2)).count).toBe(MAX_POST_FORMATS);
    const first = (await listFormats(alice, p2))[0];
    await deleteFormat(alice, p2, first.id);
    await expect(addFormat(alice, p2, f("空いた分"))).resolves.toBeTruthy();
  });

  it(`1 人の合計は ${MAX_POST_FORMATS_PER_USER} 個まで（プロジェクトを増やしてもすり抜けられない。同時でも）`, async () => {
    const { userId: carolId, client: carol } = await signUpNewUser();
    try {
      const projects: string[] = [];
      for (let i = 0; i < 6; i++) projects.push((await carol.from("projects").insert({ name: `お店 ${i}` }).select("id").single()).data!.id);
      for (const p of projects.slice(0, 5)) {
        const { error } = await carol.from("post_formats").insert(Array.from({ length: 20 }, (_, i) => ({ project_id: p, name: `f${i}`, body: "{何が}" })));
        expect(error).toBeNull();
      }
      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => addFormat(carol, projects[5], f(`越え ${i}`))));
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      expect(((results[0] as PromiseRejectedResult).reason as FormatError).userMessage).toContain(`1 人 ${MAX_POST_FORMATS_PER_USER} 個まで`);
      expect((await admin.from("post_formats").select("id", { count: "exact", head: true }).eq("owner_id", carolId)).count).toBe(MAX_POST_FORMATS_PER_USER);
    } finally {
      await deleteUser(carolId);
    }
  });

  it("プロジェクトを消すとフォーマットも消える", async () => {
    await alice.from("projects").delete().eq("id", p2);
    expect((await admin.from("post_formats").select("id", { count: "exact", head: true }).eq("project_id", p2)).count).toBe(0);
  });
});
