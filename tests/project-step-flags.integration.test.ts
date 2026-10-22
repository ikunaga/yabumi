// 「いまやること」の判定に使う値（project_step_flags。src/lib/projects/step-state.ts）: 投稿済みか・ロードマップがあるか・今週のまだのやることの数。
// 一覧で、プロジェクトの数にかかわらず 1 回で取れること、ほかの人のプロジェクトは返さないこと、ログインしていない人は呼べないこと
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listNextStep } from "@/lib/projects/next-step";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const WEEK = "2026-10-19";
const ALL = null as unknown as string;

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let posted: string;
let fresh: string;
let bobProject: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  posted = (await alice.from("projects").insert({ name: "投稿済み" }).select("id").single()).data!.id;
  fresh = (await alice.from("projects").insert({ name: "これから" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "B" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

async function flags(client: TestClient, projectId: string | null = null) {
  const { data, error } = await client.rpc("project_step_flags", { p_project_id: projectId ?? ALL, p_week_start: WEEK });
  if (error) throw error;
  return new Map(data.map((r) => [r.project_id, r]));
}

describe("project_step_flags", () => {
  it("投稿もロードマップもなければ、どれも false・0", async () => {
    const f = await flags(alice);
    expect(f.get(fresh)).toEqual({ project_id: fresh, has_published: false, has_roadmap: false, this_week_todo: 0 });
  });

  it("送信済みの配信先があれば投稿済み（失敗・予約だけでは済みにしない）", async () => {
    const { data: post } = await admin.from("posts").insert({ project_id: posted, owner_id: aliceId, body: "x", status: "scheduled", planned_at: "2026-10-20T00:00:00Z" }).select("id").single();
    await admin.from("post_targets").insert({ post_id: post!.id, owner_id: aliceId, sns: "x", status: "failed" });
    expect((await flags(alice)).get(posted)?.has_published).toBe(false);
    await admin.from("post_targets").insert({ post_id: post!.id, owner_id: aliceId, sns: "threads", status: "published", published_at: "2026-10-20T00:00:00Z" });
    expect((await flags(alice)).get(posted)?.has_published).toBe(true);
  });

  it("目標かやることがあればロードマップあり。今週のまだのやることだけを数える", async () => {
    const { error: itemsError } = await admin.from("roadmap_items").insert([
      { project_id: posted, owner_id: aliceId, title: "今週 1", week_start: WEEK, status: "todo" },
      { project_id: posted, owner_id: aliceId, title: "今週 2", week_start: WEEK, status: "todo" },
      { project_id: posted, owner_id: aliceId, title: "今週 済み", week_start: WEEK, status: "done" },
      { project_id: posted, owner_id: aliceId, title: "来週", week_start: "2026-10-26", status: "todo" },
    ]);
    expect(itemsError).toBeNull();
    await admin.from("roadmaps").insert({ project_id: fresh, owner_id: aliceId, kgi: { statement: "12 本", kpi: "posts", target: 12, deadline: "2026-12-31", sns: null } });
    const f = await flags(alice);
    expect(f.get(posted)).toMatchObject({ has_published: true, has_roadmap: true, this_week_todo: 2 });
    expect(f.get(fresh)).toMatchObject({ has_published: false, has_roadmap: true, this_week_todo: 0 });
  });

  it("一覧の次にやること: 投稿済みでロードマップもあれば、最初の投稿ではなく今週のやること", async () => {
    const f = (await flags(alice)).get(posted)!;
    const next = listNextStep({ planDone: true, connectedSnsCount: 1, hasPublished: f.has_published, hasRoadmap: f.has_roadmap, thisWeekTodo: Number(f.this_week_todo) });
    expect(next.label).toBe("今週のやること あと 2 件");
  });

  it("1 つのプロジェクトに絞れる", async () => {
    expect([...(await flags(alice, posted)).keys()]).toEqual([posted]);
  });

  it("ほかの人のプロジェクトは返さない。名指ししても返さない", async () => {
    const all = await flags(bob);
    expect([...all.keys()]).toEqual([bobProject]);
    expect((await flags(bob, posted)).size).toBe(0);
  });

  it("ログインしていない人は呼べない", async () => {
    expect((await anonClient().rpc("project_step_flags", { p_project_id: ALL, p_week_start: WEEK })).error?.code).toBe("42501");
  });
});
