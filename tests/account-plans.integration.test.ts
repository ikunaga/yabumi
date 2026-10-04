// アカウント設計（account_plans）の RLS と、セクションごとの保存
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceProject: string;
let bobProject: string;

const save = (client: TestClient, projectId: string, section: string, value: unknown) =>
  client.rpc("save_account_plan_section", { p_project_id: projectId, p_section: section, p_value: value as never });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  aliceProject = (await alice.from("projects").insert({ name: "A" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "B" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("アカウント設計", () => {
  it("セクションを保存すると、他のセクションは消えずに残る", async () => {
    expect((await save(alice, aliceProject, "goal", { what: "家計簿アプリ", goalType: "awareness", note: "" })).error).toBeNull();
    expect((await save(alice, aliceProject, "pillars", { items: [{ name: "お金のコツ", share: 40, example: "" }], tone: "です・ます", avoid: "" })).error).toBeNull();
    const { data } = await alice.from("account_plans").select("data").eq("project_id", aliceProject).single();
    expect(data!.data).toMatchObject({ goal: { what: "家計簿アプリ" }, pillars: { tone: "です・ます" } });
  });

  it("同じセクションを保存し直すと、そのセクションだけ置き換わる", async () => {
    await save(alice, aliceProject, "goal", { what: "家計簿アプリ（改）", goalType: null, note: "" });
    const { data } = await alice.from("account_plans").select("data").eq("project_id", aliceProject).single();
    const d = data!.data as Record<string, { what?: string; tone?: string }>;
    expect(d.goal.what).toBe("家計簿アプリ（改）");
    expect(d.pillars.tone).toBe("です・ます");
  });

  it("届けたい相手の本文はプロジェクトの target_audience に入り、設計には持たない", async () => {
    await save(alice, aliceProject, "audience", { who: "28 歳の会社員", pain: "お金が残らない", where: "" });
    const { data: project } = await alice.from("projects").select("target_audience").eq("id", aliceProject).single();
    expect(project!.target_audience).toBe("28 歳の会社員");
    const { data } = await alice.from("account_plans").select("data").eq("project_id", aliceProject).single();
    expect((data!.data as Record<string, Record<string, string>>).audience).toEqual({ pain: "お金が残らない", where: "" });
  });

  it("知らないセクションは保存できない", async () => {
    expect((await save(alice, aliceProject, "unknown", {})).error).not.toBeNull();
    expect((await save(alice, aliceProject, "goal", "text")).error).not.toBeNull();
  });

  it("他人の設計は読めない", async () => {
    expect((await bob.from("account_plans").select("*").eq("project_id", aliceProject)).data).toEqual([]);
  });

  it("他人のプロジェクトに設計を保存できない", async () => {
    expect((await save(bob, aliceProject, "goal", { what: "乗っ取り" })).error).not.toBeNull();
    expect((await save(bob, aliceProject, "audience", { who: "乗っ取り" })).error).not.toBeNull();
    const { data } = await alice.from("projects").select("target_audience").eq("id", aliceProject).single();
    expect(data!.target_audience).toBe("28 歳の会社員");
  });

  it("他人の設計を書き換え・削除できない", async () => {
    await bob.from("account_plans").update({ data: {} }).eq("project_id", aliceProject);
    await bob.from("account_plans").delete().eq("project_id", aliceProject);
    const { data } = await alice.from("account_plans").select("data").eq("project_id", aliceProject).single();
    expect(data!.data).toHaveProperty("goal");
  });

  it("自分の設計を、他人のプロジェクトに付け替えられない", async () => {
    const { error } = await alice.from("account_plans").update({ project_id: bobProject }).eq("project_id", aliceProject);
    expect(error).not.toBeNull();
  });

  it("「あとで設計する」を記録でき、書いた中身は残る", async () => {
    const { error } = await alice
      .from("account_plans")
      .upsert({ project_id: aliceProject, skipped_at: new Date().toISOString() }, { onConflict: "project_id" });
    expect(error).toBeNull();
    const { data } = await alice.from("account_plans").select("data, skipped_at").eq("project_id", aliceProject).single();
    expect(data!.skipped_at).not.toBeNull();
    expect(data!.data).toHaveProperty("goal");
  });
});
