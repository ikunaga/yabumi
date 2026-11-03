// 数字で目標に届いたやることを、プロジェクトの一覧（DB の project_step_flags）と概要・ロードマップ（アプリの effectiveStatus）で同じに数える。
// 週の区切り（日本時間の月曜 0 時）とクリックの数え方（roadmap_daily_totals のその週）が、DB とアプリで食い違わないこと
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listNextStep } from "@/lib/projects/next-step";
import { loadRoadmapWith, thisWeekCounts, thisWeekTodos } from "@/lib/roadmap/load";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const WEEK = "2026-10-19";
// 2026-10-21（水）12:00 日本時間
const NOW = new Date("2026-10-21T03:00:00Z");

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let linkId: string;

async function published(at: string) {
  const { data: post, error } = await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "x", status: "draft" }).select("id").single();
  if (error) throw error;
  const t = await admin.from("post_targets").insert({ post_id: post.id, owner_id: aliceId, sns: "x", status: "published", published_at: at });
  if (t.error) throw t.error;
}

async function clicks(day: string, n: number) {
  const { error } = await admin.from("link_click_daily").insert({ owner_id: aliceId, link_id: linkId, day, device: "ios", clicks: n });
  if (error) throw error;
}

async function compare() {
  const view = await loadRoadmapWith(alice, projectId, NOW);
  const { data, error } = await alice.rpc("project_step_flags", { p_project_id: projectId, p_week_start: view.thisWeek });
  if (error) throw error;
  return { view, db: Number(data[0].this_week_todo), app: thisWeekCounts(view).open };
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "達成" }).select("id").single()).data!.id;
  const items = await admin.from("roadmap_items").insert([
    { project_id: projectId, owner_id: aliceId, title: "2 本投稿", week_start: WEEK, status: "todo", kpi: "posts", target: 2, position: 0 },
    { project_id: projectId, owner_id: aliceId, title: "3 本投稿", week_start: WEEK, status: "todo", kpi: "posts", target: 3, position: 1 },
    { project_id: projectId, owner_id: aliceId, title: "クリック 5 回", week_start: WEEK, status: "todo", kpi: "link_clicks", target: 5, position: 2 },
    { project_id: projectId, owner_id: aliceId, title: "フォロワー 10", week_start: WEEK, status: "todo", kpi: "followers", target: 10, position: 3 },
  ]);
  if (items.error) throw items.error;
  const link = await admin
    .from("short_links")
    .insert({ owner_id: aliceId, project_id: projectId, code: `ach${aliceId.slice(0, 6)}`, destination_url: "https://example.com/", kind: "profile", sns: "x" })
    .select("id")
    .single();
  if (link.error) throw link.error;
  linkId = link.data.id;
  // 週の境目: 日曜 23:30（前の週）・月曜 0:30（この週）・日曜 23:30（この週）・月曜 0:30（次の週）。どれも日本時間
  await published("2026-10-18T14:30:00Z");
  await published("2026-10-18T15:30:00Z");
  await published("2026-10-25T14:30:00Z");
  await published("2026-10-25T15:30:00Z");
  // クリック: 前の週の日曜に 9、この週の日曜に 3、次の週の月曜に 4
  await clicks("2026-10-18", 9);
  await clicks("2026-10-25", 3);
  await clicks("2026-10-26", 4);
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("数字で達成したやることを、一覧と概要で同じに数える", () => {
  it("週の境目（日本時間の月曜 0 時）を DB とアプリで同じに区切る: 投稿 2 本で「2 本投稿」だけ達成", async () => {
    const { view, db, app } = await compare();
    expect(view.thisWeek).toBe(WEEK);
    // まだ: 3 本投稿（2 / 3）・クリック 5 回（3 / 5）・フォロワー 10（手で数える数字は対象外）
    expect(thisWeekTodos(view).map((t) => t.title)).toEqual(["3 本投稿", "クリック 5 回", "フォロワー 10"]);
    expect(app).toBe(3);
    expect(db).toBe(3);
    expect(listNextStep({ planDone: true, connectedSnsCount: 1, hasPublished: true, hasRoadmap: true, thisWeekTodo: db }).label).toBe("今週のやること あと 3 件");
  });

  it("クリックはその週（月〜日）の合計で決める。届けば達成、DB の status は書き換えない", async () => {
    await clicks("2026-10-19", 2);
    const { view, db, app } = await compare();
    expect(thisWeekTodos(view).map((t) => t.title)).toEqual(["3 本投稿", "フォロワー 10"]);
    expect([app, db]).toEqual([2, 2]);
    const { data } = await admin.from("roadmap_items").select("status").eq("project_id", projectId);
    expect(data!.every((r) => r.status === "todo")).toBe(true);
  });

  it("数字があとで減れば、まだに戻る", async () => {
    await admin.from("link_click_daily").delete().eq("link_id", linkId).eq("day", "2026-10-19");
    const { db, app } = await compare();
    expect([app, db]).toEqual([3, 3]);
  });

  it("他人のプロジェクトは数えない", async () => {
    const { data } = await bob.rpc("project_step_flags", { p_project_id: projectId, p_week_start: WEEK });
    expect(data).toEqual([]);
  });
});
