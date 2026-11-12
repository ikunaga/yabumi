// 数字で目標に届いたやることを、プロジェクトの一覧（DB の project_step_flags）と概要・ロードマップ（アプリの effectiveStatus）で同じに数える。
// 週の区切り（日本時間の月曜 0 時）とクリックの数え方（roadmap_daily_totals のその週）が、DB とアプリで食い違わないこと。
// まだの数に加えて済んだ数も突き合わせる（一覧の「✓ 今週のやることは済みました」。2026-11-12 オーナーの指摘）。予約だけ・一部の SNS だけ送れた・手で済み・やらないも
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toCalendarTodo } from "@/lib/calendar/roadmap-view";
import { listNextStep } from "@/lib/projects/next-step";
import { loadRoadmapWith, thisWeekCounts, thisWeekTodos } from "@/lib/roadmap/load";
import { adminClient, deleteUser, signUpNewUser, type TestClient, goalLess } from "./helpers/supabase";

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

// 配信先ごとの状態を決めて投稿を入れる（予約だけ・一部の SNS だけ送れた）
async function post(plannedAt: string, targets: { sns: "x" | "threads"; status: "pending" | "published" | "failed"; published_at?: string }[]) {
  const { data, error } = await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "x", status: "scheduled", planned_at: plannedAt }).select("id").single();
  if (error) throw error;
  const t = await admin.from("post_targets").insert(targets.map((x) => ({ post_id: data.id, owner_id: aliceId, ...x })));
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
  const app = thisWeekCounts(view);
  return { view, db: Number(data[0].this_week_todo), app: app.open, dbDone: Number(data[0].this_week_done), appDone: app.finished };
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "達成" }).select("id").single()).data!.id;
  const items = await admin.from("roadmap_items").insert(goalLess([
    { project_id: projectId, owner_id: aliceId, title: "2 本投稿", week_start: WEEK, status: "todo", kpi: "posts", target: 2, position: 0 },
    { project_id: projectId, owner_id: aliceId, title: "3 本投稿", week_start: WEEK, status: "todo", kpi: "posts", target: 3, position: 1 },
    { project_id: projectId, owner_id: aliceId, title: "クリック 5 回", week_start: WEEK, status: "todo", kpi: "link_clicks", target: 5, position: 2 },
    { project_id: projectId, owner_id: aliceId, title: "フォロワー 10", week_start: WEEK, status: "todo", kpi: "followers", target: 10, position: 3 },
  ]));
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
    expect(listNextStep({ planDone: true, connectedSnsCount: 1, hasPublished: true, hasRoadmap: true, thisWeek: { open: db, finished: 1 } }).label).toBe("今週のやること あと 3 件");
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

  it("予約しただけでまだ送っていない投稿は数えない（送ってから達成）", async () => {
    await post("2026-10-22T03:00:00Z", [{ sns: "x", status: "pending" }]);
    const { view, db, app, dbDone, appDone } = await compare();
    expect(thisWeekTodos(view).map((t) => t.title)).toEqual(["3 本投稿", "クリック 5 回", "フォロワー 10"]);
    expect([app, db, appDone, dbDone]).toEqual([3, 3, 1, 1]);
  });

  it("一部の SNS だけ送れた投稿は、送れた配信先だけ数える", async () => {
    await post("2026-10-22T03:00:00Z", [
      { sns: "x", status: "published", published_at: "2026-10-22T03:00:00Z" },
      { sns: "threads", status: "failed" },
    ]);
    const { view, db, app, dbDone, appDone } = await compare();
    // 投稿 3 本（月曜 0:30・水曜の X・日曜 23:30）で「3 本投稿」も達成
    expect(thisWeekTodos(view).map((t) => t.title)).toEqual(["クリック 5 回", "フォロワー 10"]);
    expect([app, db, appDone, dbDone]).toEqual([2, 2, 2, 2]);
  });

  it("手で済み・やらないも同じに数え、全部済んだら一覧は「済みました」", async () => {
    await admin.from("roadmap_items").update({ status: "done" }).eq("project_id", projectId).eq("title", "フォロワー 10");
    const sk = await admin.from("roadmap_items").insert(goalLess([{ project_id: projectId, owner_id: aliceId, title: "やらない", week_start: WEEK, status: "skipped", position: 4 }]));
    if (sk.error) throw sk.error;
    expect(await compare()).toMatchObject({ app: 1, db: 1, appDone: 3, dbDone: 3 });
    await clicks("2026-10-20", 2);
    const { db, app, dbDone, appDone } = await compare();
    expect([app, db, appDone, dbDone]).toEqual([0, 0, 4, 4]);
    expect(listNextStep({ planDone: true, connectedSnsCount: 1, hasPublished: true, hasRoadmap: true, thisWeek: { open: db, finished: dbDone } }).label).toBe("✓ 今週のやることは済みました");
  });

  it("他人のプロジェクトは数えない", async () => {
    const { data } = await bob.rpc("project_step_flags", { p_project_id: projectId, p_week_start: WEEK });
    expect(data).toEqual([]);
  });
});

// 2026-11-12 PMO の本番での通しテスト: 数字で数えないやることは、そのやることから作った投稿（roadmap_item_id）を送っても「まだ」に残った。
// 結びついた投稿の配信先が 1 つ以上送信済みなら済み。予約だけ・失敗だけでは済みにしない。一覧（DB）・概要とロードマップ（thisWeekCounts）・カレンダーで同じ
describe("数字で数えないやることは、ここから作った投稿を送ったら済み（一覧・概要・カレンダーで同じ）", () => {
  let pid: string;
  let profileId: string;
  let writeId: string;

  async function linkedPost(itemId: string, targets: { sns: "x" | "threads"; status: "pending" | "published" | "failed"; published_at?: string }[]) {
    const { data, error } = await admin
      .from("posts")
      .insert({ project_id: pid, owner_id: aliceId, body: "x", status: "scheduled", planned_at: "2026-10-22T03:00:00Z", roadmap_item_id: itemId })
      .select("id")
      .single();
    if (error) throw error;
    const t = await admin.from("post_targets").insert(targets.map((x) => ({ post_id: data.id, owner_id: aliceId, ...x })));
    if (t.error) throw t.error;
  }

  async function compareAll() {
    const view = await loadRoadmapWith(alice, pid, NOW);
    const { data, error } = await alice.rpc("project_step_flags", { p_project_id: pid, p_week_start: view.thisWeek });
    if (error) throw error;
    const app = thisWeekCounts(view);
    const calendar = view.items.filter((i) => i.weekStart === view.thisWeek).map((i) => toCalendarTodo(i, view.daily, view.today));
    return {
      db: [Number(data[0].this_week_todo), Number(data[0].this_week_done)],
      app: [app.open, app.finished],
      calendarOpen: calendar.filter((t) => t.status === "todo").map((t) => t.title),
      overviewOpen: thisWeekTodos(view).map((t) => t.title),
    };
  }

  beforeAll(async () => {
    pid = (await alice.from("projects").insert({ name: "結びついた投稿" }).select("id").single()).data!.id;
    const { data, error } = await admin
      .from("roadmap_items")
      .insert(
        goalLess([
          { project_id: pid, owner_id: aliceId, title: "季節のおすすめで 1 本書く", week_start: WEEK, status: "todo", kind: "post", position: 0 },
          { project_id: pid, owner_id: aliceId, title: "プロフィールに短縮リンクを置く", week_start: WEEK, status: "todo", kind: "setup", position: 1 },
        ]),
      )
      .select("id, title");
    if (error) throw error;
    writeId = data.find((r) => r.title.startsWith("季節"))!.id;
    profileId = data.find((r) => r.title.startsWith("プロフィール"))!.id;
  });

  it("予約しただけ・失敗しただけの投稿では済みにしない", async () => {
    await linkedPost(writeId, [{ sns: "x", status: "pending" }]);
    await linkedPost(writeId, [{ sns: "threads", status: "failed" }]);
    const r = await compareAll();
    expect(r.db).toEqual([2, 0]);
    expect(r.app).toEqual([2, 0]);
    expect(r.calendarOpen).toEqual(["季節のおすすめで 1 本書く", "プロフィールに短縮リンクを置く"]);
  });

  it("結びついた投稿の配信先が 1 つ送信済みなら済み（一部の SNS だけ送れた投稿も）", async () => {
    await linkedPost(writeId, [
      { sns: "x", status: "published", published_at: "2026-10-22T03:00:00Z" },
      { sns: "threads", status: "failed" },
    ]);
    const r = await compareAll();
    expect(r.db).toEqual([1, 1]);
    expect(r.app).toEqual([1, 1]);
    expect(r.calendarOpen).toEqual(["プロフィールに短縮リンクを置く"]);
    expect(r.overviewOpen).toEqual(["プロフィールに短縮リンクを置く"]);
    // DB の status は書き換えない
    const { data } = await admin.from("roadmap_items").select("status").eq("id", writeId).single();
    expect(data!.status).toBe("todo");
  });

  it("結びついていない投稿は数えない。手で済みにすれば、どこでも済み", async () => {
    // このプロジェクトの、やることと結びついていない送った投稿
    const { data: free, error } = await admin.from("posts").insert({ project_id: pid, owner_id: aliceId, body: "x", status: "draft" }).select("id").single();
    if (error) throw error;
    await admin.from("post_targets").insert({ post_id: free.id, owner_id: aliceId, sns: "x", status: "published", published_at: "2026-10-23T03:00:00Z" });
    expect((await compareAll()).db).toEqual([1, 1]);
    expect((await compareAll()).app).toEqual([1, 1]);
    await admin.from("roadmap_items").update({ status: "done" }).eq("id", profileId);
    const r = await compareAll();
    expect(r.db).toEqual([0, 2]);
    expect(r.app).toEqual([0, 2]);
    expect(r.calendarOpen).toEqual([]);
  });
});
