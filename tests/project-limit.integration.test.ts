// プロジェクトは 1 人 10 個まで（2026-11-07 オーナーの決定。20261107130000_project_limit）: 10 個まで作れる、11 個目は断る、
// 同時に作っても超えない、他人の数には影響しない、消せばまた作れる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isProjectLimitError, MAX_PROJECTS_PER_USER, projectLimitReached } from "@/lib/projects/limits";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;

const create = (client: TestClient, name: string) => client.from("projects").insert({ name }).select("id").single();
const countOf = async (owner: string) => (await admin.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", owner)).count;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("プロジェクトの数の上限", () => {
  it("アプリと DB の上限は同じ 10 個", () => {
    expect(MAX_PROJECTS_PER_USER).toBe(10);
    expect(projectLimitReached(9)).toBe(false);
    expect(projectLimitReached(10)).toBe(true);
  });

  it("10 個まで作れ、11 個目は DB が断る（どの経路から足しても）", async () => {
    for (let i = 1; i <= 10; i++) expect((await create(alice, `店 ${i}`)).error).toBeNull();
    const r = await create(alice, "11 個目");
    expect(isProjectLimitError(r.error)).toBe(true);
    // サーバーの権限で足しても同じ
    expect(isProjectLimitError((await admin.from("projects").insert({ name: "11 個目", owner_id: aliceId })).error)).toBe(true);
    expect(await countOf(aliceId)).toBe(10);
  });

  it("他人の数には影響しない。1 つ消せば、また作れる", async () => {
    expect((await create(bob, "ほかの人の店")).error).toBeNull();
    const { data } = await alice.from("projects").select("id").limit(1).single();
    await alice.from("projects").delete().eq("id", data!.id);
    expect((await create(alice, "空いた分")).error).toBeNull();
    expect(isProjectLimitError((await create(alice, "また 11 個目")).error)).toBe(true);
  });

  it("同時に作っても 10 個を超えない", async () => {
    const { userId, client } = await signUpNewUser();
    try {
      await Promise.all(Array.from({ length: 8 }, (_, i) => create(client, `先に ${i}`)));
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(client, `同時 ${i}`)));
      expect(results.filter((r) => r.error === null)).toHaveLength(2);
      expect(results.filter((r) => isProjectLimitError(r.error))).toHaveLength(4);
      expect(await countOf(userId)).toBe(10);
    } finally {
      await deleteUser(userId);
    }
  });
});
