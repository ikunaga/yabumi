// ローカルの Supabase（supabase start）が必要な結合テスト。
// 行単位アクセス制御（RLS）で、他人のプロジェクトを読み書きできないことを確かめる。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

describe("projects の RLS", () => {
  let alice: TestClient;
  let bob: TestClient;
  let aliceId: string;
  let bobId: string;
  let aliceProjectId: string;

  beforeAll(async () => {
    ({ client: alice, userId: aliceId } = await signUpNewUser());
    ({ client: bob, userId: bobId } = await signUpNewUser());
    const { data, error } = await alice.from("projects").insert({ name: "Alice のアプリ" }).select("id").single();
    if (error) throw error;
    aliceProjectId = data.id;
  });

  // テストで作ったユーザーは消す（プロジェクトも一緒に消える）
  afterAll(async () => {
    await deleteUser(aliceId);
    await deleteUser(bobId);
  });

  it("本人は自分のプロジェクトを読める", async () => {
    const { data } = await alice.from("projects").select("id").eq("id", aliceProjectId);
    expect(data).toHaveLength(1);
  });

  it("他人は読めない", async () => {
    const { data } = await bob.from("projects").select("id").eq("id", aliceProjectId);
    expect(data).toHaveLength(0);
  });

  it("他人は更新できない", async () => {
    const { data } = await bob.from("projects").update({ name: "乗っ取り" }).eq("id", aliceProjectId).select("id");
    expect(data).toHaveLength(0);
    const { data: after } = await alice.from("projects").select("name").eq("id", aliceProjectId).single();
    expect(after?.name).toBe("Alice のアプリ");
  });

  it("他人は削除できない", async () => {
    const { data } = await bob.from("projects").delete().eq("id", aliceProjectId).select("id");
    expect(data).toHaveLength(0);
  });

  it("他人の名義でプロジェクトを作れない", async () => {
    const { data: aliceUser } = await alice.auth.getUser();
    const { error } = await bob.from("projects").insert({ name: "なりすまし", owner_id: aliceUser.user!.id });
    expect(error).not.toBeNull();
  });

  it("未ログインでは何も読めない", async () => {
    const anon = anonClient();
    const { data } = await anon.from("projects").select("id");
    expect(data ?? []).toHaveLength(0);
  });
});
