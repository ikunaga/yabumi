// 「いまのタスク」と一覧の「つないだ SNS」: 手動で投稿の SNS（note・Substack）は、つながなくても使うので、URL を登録していれば「つないだ」に数える
// （2026-11-24 オーナーの指示「他の画面でも同様の箇所ないか確認して、あれば横展開で」。PM の判断の案 1。src/lib/projects/step-state.ts）。
// 画面と同じく利用者の権限（RLS）で読む。テストの行はこのファイルの利用者だけに作る
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
let current: unknown;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
import { currentStepIndex } from "@/lib/projects/next-step";
import { loadStepStates } from "@/lib/projects/step-state";
import { deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "note だけ" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "ほかの人" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

const state = async (client: TestClient, id: string) => {
  current = client;
  return (await loadStepStates([{ id, target_audience: "" }]))[id];
};

describe("手動で投稿の SNS を「つないだ」に数える", () => {
  it("URL を登録していなければ、つないだ SNS はなし", async () => {
    const s = await state(alice, projectId);
    expect(s.connectedSns).toEqual([]);
    expect(s.connectedSnsCount).toBe(0);
  });

  it("note の URL を登録したら、つないだ SNS に数え、「SNS をつなぐ」の段階を過ぎる", async () => {
    const { error } = await alice.from("project_manual_channels").insert({ project_id: projectId, sns: "note", profile_url: "https://note.com/example" });
    expect(error).toBeNull();
    const s = await state(alice, projectId);
    expect(s.connectedSns).toEqual(["note"]);
    expect(s.connectedSnsCount).toBe(1);
    expect(currentStepIndex({ ...s, planDone: true })).toBeGreaterThan(1);
  });

  it("ほかの人のプロジェクトの登録は数えない（RLS）", async () => {
    await bob.from("project_manual_channels").insert({ project_id: bobProject, sns: "substack", profile_url: "https://example.substack.com" });
    current = alice;
    const all = await loadStepStates([
      { id: projectId, target_audience: "" },
      { id: bobProject, target_audience: "" },
    ]);
    expect(all[projectId].connectedSns).toEqual(["note"]);
    expect(all[bobProject].connectedSns).toEqual([]);
  });
});
