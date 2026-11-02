// 宣伝するものの種類・行き先の URL・手で入れる成果（決定 D34。マイグレーション 20261102100000）。
// 他人からは読めない・書けない、ログインしていない人は触れない、プロジェクトを消すと消える
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "パン屋" }).select("id, product_type").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("宣伝するものの種類", () => {
  it("前のプロジェクトと同じく、何も入れなければアプリ。決まった 7 つだけ入れられる", async () => {
    expect((await alice.from("projects").select("product_type").eq("id", projectId).single()).data).toEqual({ product_type: "app" });
    expect((await alice.from("projects").update({ product_type: "shop" }).eq("id", projectId)).error).toBeNull();
    expect((await alice.from("projects").update({ product_type: "restaurant" }).eq("id", projectId)).error?.code).toBe("23514");
    // 他人は変えられない（行が見えないので 0 件）
    expect((await bob.from("projects").update({ product_type: "app" }).eq("id", projectId).select("id")).data).toEqual([]);
  });
});

describe("行き先の URL", () => {
  it("本人は自分のプロジェクトに足して読める。他人は読めず、足せず、書き換えも消しもできない", async () => {
    const { data: row, error } = await alice
      .from("project_destinations")
      .insert({ project_id: projectId, owner_id: aliceId, kind: "booking", label: "予約", url: "https://example.com/reserve" })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect((await bob.from("project_destinations").select("*").eq("project_id", projectId)).data).toEqual([]);
    // 他人のプロジェクトには、自分の名前でも足せない
    expect((await bob.from("project_destinations").insert({ project_id: projectId, owner_id: bobId, kind: "site", url: "https://evil.example" })).error?.code).toBe("42501");
    expect((await bob.from("project_destinations").update({ url: "https://evil.example" }).eq("id", row!.id).select("id")).data).toEqual([]);
    expect((await bob.from("project_destinations").delete().eq("id", row!.id).select("id")).data).toEqual([]);
    expect((await anonClient().from("project_destinations").select("*").limit(1)).error?.code).toBe("42501");
    // https でない URL・決まっていない種類は入れられない
    expect((await alice.from("project_destinations").insert({ project_id: projectId, owner_id: aliceId, kind: "site", url: "http://example.com" })).error?.code).toBe("23514");
    expect((await alice.from("project_destinations").insert({ project_id: projectId, owner_id: aliceId, kind: "blog", url: "https://example.com" })).error?.code).toBe("23514");
  });

  it("1 つのプロジェクトに 20 まで", async () => {
    const p = (await alice.from("projects").insert({ name: "上限" }).select("id").single()).data!.id;
    const rows = Array.from({ length: 20 }, (_, i) => ({ project_id: p, owner_id: aliceId, kind: "site", url: `https://example.com/${i}` }));
    expect((await alice.from("project_destinations").insert(rows)).error).toBeNull();
    expect((await alice.from("project_destinations").insert({ project_id: p, owner_id: aliceId, kind: "site", url: "https://example.com/21" })).error?.message).toContain("20 まで");
  });
});

describe("手で入れる成果", () => {
  it("本人は日ごとに入れて直せる。他人は読めず書けない。決まった成果と数の範囲だけ", async () => {
    const day = "2026-10-30";
    expect((await alice.from("project_outcomes_daily").insert({ project_id: projectId, owner_id: aliceId, day, action: "booking", count: 3 })).error).toBeNull();
    expect((await alice.from("project_outcomes_daily").upsert({ project_id: projectId, owner_id: aliceId, day, action: "booking", count: 4 })).error).toBeNull();
    expect((await alice.from("project_outcomes_daily").select("count").eq("project_id", projectId).single()).data).toEqual({ count: 4 });
    expect((await bob.from("project_outcomes_daily").select("*").eq("project_id", projectId)).data).toEqual([]);
    expect((await bob.from("project_outcomes_daily").insert({ project_id: projectId, owner_id: bobId, day, action: "visit", count: 1 })).error?.code).toBe("42501");
    expect((await anonClient().from("project_outcomes_daily").select("*").limit(1)).error?.code).toBe("42501");
    expect((await alice.from("project_outcomes_daily").insert({ project_id: projectId, owner_id: aliceId, day, action: "download", count: 1 })).error?.code).toBe("23514");
    expect((await alice.from("project_outcomes_daily").insert({ project_id: projectId, owner_id: aliceId, day, action: "visit", count: -1 })).error?.code).toBe("23514");
  });

  it("プロジェクトを消すと、行き先と成果も消える", async () => {
    const p = (await alice.from("projects").insert({ name: "消す" }).select("id").single()).data!.id;
    await alice.from("project_destinations").insert({ project_id: p, owner_id: aliceId, kind: "site", url: "https://example.com" });
    await alice.from("project_outcomes_daily").insert({ project_id: p, owner_id: aliceId, day: "2026-10-30", action: "visit", count: 2 });
    expect((await alice.from("projects").delete().eq("id", p)).error).toBeNull();
    expect((await alice.from("project_destinations").select("id").eq("project_id", p)).data).toEqual([]);
    expect((await alice.from("project_outcomes_daily").select("day").eq("project_id", p)).data).toEqual([]);
  });
});
