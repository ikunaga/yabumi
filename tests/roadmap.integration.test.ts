// ロードマップ（docs/architecture.md の 4.23）: RLS と権限、DB での日ごとの合計、目標とやることの書き込み
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRoadmapWith } from "@/lib/roadmap/load";
import { itemProgress } from "@/lib/roadmap/schema";
import { addItems, saveGoal } from "@/lib/roadmap/write";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProjectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "ロードマップ" }).select("id").single()).data!.id;
  bobProjectId = (await bob.from("projects").insert({ name: "B" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("目標とやることの書き込み", () => {
  it("目標を作ると、今日から数え始める。やることは週ごとに足せる", async () => {
    await saveGoal(alice, projectId, { kgi: { statement: "1 か月で 12 本", kpi: "posts", target: 12, deadline: "2026-11-30", sns: null }, kpiTargets: [{ kpi: "posts", per_week: 3, sns: null }] }, "ai");
    const { data: r } = await alice.from("roadmaps").select("*").eq("project_id", projectId).single();
    expect(r).toMatchObject({ source: "ai", kgi: { kpi: "posts", target: 12 }, kpi_targets: [{ kpi: "posts", per_week: 3 }] });
    expect(r!.started_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(await addItems(alice, projectId, [{ title: "1 本書く", detail: "", week_start: "2026-10-12", kpi: "posts", target: 1, sns: null }], "manual")).toBe(1);
    const { data: items } = await alice.from("roadmap_items").select("title, week_start, kpi, target, status").eq("project_id", projectId);
    expect(items).toEqual([{ title: "1 本書く", week_start: "2026-10-12", kpi: "posts", target: 1, status: "todo" }]);
  });

  it("週の始まりが月曜でないもの、数字と目標の値の片方だけのものは、DB でも断る", async () => {
    expect((await alice.from("roadmap_items").insert({ project_id: projectId, title: "x", week_start: "2026-10-13" })).error).not.toBeNull();
    expect((await alice.from("roadmap_items").insert({ project_id: projectId, title: "x", week_start: "2026-10-12", kpi: "posts" })).error).not.toBeNull();
  });
});

describe("RLS と権限", () => {
  it("ほかの人のロードマップは読めない・書けない・消せない", async () => {
    expect((await bob.from("roadmaps").select("project_id").eq("project_id", projectId)).data).toEqual([]);
    expect((await bob.from("roadmap_items").select("id").eq("project_id", projectId)).data).toEqual([]);
    // 他人のプロジェクトには作れない
    expect((await bob.from("roadmap_items").insert({ project_id: projectId, title: "x", week_start: "2026-10-12" })).error).not.toBeNull();
    expect((await bob.from("roadmaps").insert({ project_id: projectId })).error).not.toBeNull();
    // 自分のものとして作っても、他人のプロジェクトにはつけられない
    expect((await bob.from("roadmap_items").insert({ project_id: projectId, owner_id: bobId, title: "x", week_start: "2026-10-12" })).error).not.toBeNull();
    // 書き換え・削除は、見えないので何も起きない
    await bob.from("roadmap_items").update({ status: "done" }).eq("project_id", projectId);
    await bob.from("roadmap_items").delete().eq("project_id", projectId);
    const { data } = await admin.from("roadmap_items").select("status").eq("project_id", projectId);
    expect(data!.every((i) => i.status === "todo")).toBe(true);
    expect(data!.length).toBeGreaterThan(0);
  });

  it("自分のやることを他人のプロジェクトへ移せない", async () => {
    const { data: item } = await alice.from("roadmap_items").select("id").eq("project_id", projectId).limit(1).single();
    const { error } = await alice.from("roadmap_items").update({ project_id: bobProjectId }).eq("id", item!.id);
    expect(error).not.toBeNull();
  });

  it("ログインしていない人は、どちらの表も関数も使えない", async () => {
    expect((await anonClient().from("roadmaps").select("*").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("roadmap_items").select("*").limit(1)).error?.code).toBe("42501");
    const r = await anonClient().rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: "2026-10-01", p_to: "2026-10-31" });
    expect(r.error?.code).toBe("42501");
    expect((await anonClient().rpc("post_counts_by_day", { p_project_id: projectId, p_from: "2026-10-01", p_to: "2026-10-31" })).error?.code).toBe("42501");
    expect((await anonClient().rpc("counted_post_targets", { p_project_id: projectId, p_from: "2026-10-01", p_to: "2026-10-31" })).error?.code).toBe("42501");
  });
});

describe("日ごとの数字（roadmap_daily_totals）", () => {
  it("送った投稿の数と、短縮リンクのクリックを、日本時間の日ごとに DB で合計する。他人には 0 に見える", async () => {
    const { data: post, error: postError } = await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "x", status: "scheduled", planned_at: "2026-10-13T00:00:00Z" }).select("id").single();
    expect(postError).toBeNull();
    // 日本時間 10/14 の 0:30 と 23:30（UTC では 10/13 15:30 と 10/14 14:30）
    await admin.from("post_targets").insert([
      { post_id: post!.id, owner_id: aliceId, sns: "threads", status: "published", published_at: "2026-10-13T15:30:00Z" },
      { post_id: post!.id, owner_id: aliceId, sns: "x", status: "published", published_at: "2026-10-14T14:30:00Z" },
      { post_id: post!.id, owner_id: aliceId, sns: "facebook", status: "failed" },
    ]);
    const { data: link } = await admin
      .from("short_links")
      .insert({ owner_id: aliceId, project_id: projectId, code: randomUUID().replace(/-/g, "").slice(0, 10), destination_url: "https://example.com", kind: "custom" })
      .select("id")
      .single();
    await admin.from("link_click_daily").insert([
      { link_id: link!.id, owner_id: aliceId, day: "2026-10-14", device: "ios", clicks: 3 },
      { link_id: link!.id, owner_id: aliceId, day: "2026-10-14", device: "android", clicks: 2 },
      { link_id: link!.id, owner_id: aliceId, day: "2026-10-15", device: "ios", clicks: 1 },
    ]);

    const { data, error } = await alice.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: "2026-10-13", p_to: "2026-10-15" });
    expect(error).toBeNull();
    expect(data!.map((d) => ({ day: d.day, posts: Number(d.posts), link_clicks: Number(d.link_clicks) }))).toEqual([
      { day: "2026-10-13", posts: 0, link_clicks: 0 },
      { day: "2026-10-14", posts: 2, link_clicks: 5 },
      { day: "2026-10-15", posts: 0, link_clicks: 1 },
    ]);

    const { data: forBob } = await bob.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: "2026-10-13", p_to: "2026-10-15" });
    expect(forBob!.every((d) => Number(d.posts) === 0 && Number(d.link_clicks) === 0)).toBe(true);
  });
});

describe("SNS ごとの数（post_counts_by_day。指標・ロードマップ・伴走の数え方の 1 か所）", () => {
  let p2: string;
  beforeAll(async () => {
    p2 = (await alice.from("projects").insert({ name: "SNS ごと" }).select("id").single()).data!.id;
    // X と Threads に送信済み 1 本ずつ（日本時間 10/20）、Instagram は予約済み（10/22）、Facebook は失敗、下書きは数えない
    const { data: sent } = await admin.from("posts").insert({ project_id: p2, owner_id: aliceId, body: "送った", status: "scheduled", planned_at: "2026-10-20T01:00:00Z" }).select("id").single();
    const { data: planned } = await admin.from("posts").insert({ project_id: p2, owner_id: aliceId, body: "予約", status: "scheduled", planned_at: "2026-10-22T01:00:00Z" }).select("id").single();
    const { data: draft } = await admin.from("posts").insert({ project_id: p2, owner_id: aliceId, body: "下書き", status: "draft" }).select("id").single();
    await admin.from("post_targets").insert([
      { post_id: sent!.id, owner_id: aliceId, sns: "x", status: "published", published_at: "2026-10-20T01:00:00Z" },
      { post_id: sent!.id, owner_id: aliceId, sns: "threads", status: "published", published_at: "2026-10-20T01:00:00Z" },
      { post_id: sent!.id, owner_id: aliceId, sns: "facebook", status: "failed" },
      { post_id: planned!.id, owner_id: aliceId, sns: "instagram", status: "pending" },
      { post_id: draft!.id, owner_id: aliceId, sns: "instagram", status: "pending" },
    ]);
  });

  it("SNS ごとに、送信済み（送った日）と予約済み（予約の日）を数える。失敗と下書きは数えない。他人には見えない", async () => {
    const { data, error } = await alice.rpc("post_counts_by_day", { p_project_id: p2, p_from: "2026-10-19", p_to: "2026-10-25" });
    expect(error).toBeNull();
    const rows = data!.map((r) => ({ day: r.day, sns: r.sns, published: Number(r.published), scheduled: Number(r.scheduled) })).sort((a, b) => (a.day + a.sns).localeCompare(b.day + b.sns));
    expect(rows).toEqual([
      { day: "2026-10-20", sns: "threads", published: 1, scheduled: 0 },
      { day: "2026-10-20", sns: "x", published: 1, scheduled: 0 },
      { day: "2026-10-22", sns: "instagram", published: 0, scheduled: 1 },
    ]);
    expect((await bob.rpc("post_counts_by_day", { p_project_id: p2, p_from: "2026-10-19", p_to: "2026-10-25" })).data).toEqual([]);
    // すべての SNS の合計（roadmap_daily_totals）も同じ数え方: 送信済みの 2
    const { data: totals } = await alice.rpc("roadmap_daily_totals", { p_project_id: p2, p_from: "2026-10-20", p_to: "2026-10-20" });
    expect(Number(totals![0].posts)).toBe(2);
  });

  it("「Instagram に 1 本」のやることは、Instagram に送っていなければ 0 / 1（X と Threads の分は数えない）", async () => {
    await addItems(
      alice,
      p2,
      [
        { title: "Instagram に 1 本", detail: "", week_start: "2026-10-19", kpi: "posts", target: 1, sns: "instagram" },
        { title: "X に 1 本", detail: "", week_start: "2026-10-19", kpi: "posts", target: 1, sns: "x" },
        { title: "どこかに 2 本", detail: "", week_start: "2026-10-19", kpi: "posts", target: 2, sns: null },
      ],
      "manual",
    );
    const view = await loadRoadmapWith(alice, p2, new Date("2026-10-23T03:00:00Z"));
    const progress = Object.fromEntries(view.items.map((i) => [i.title, itemProgress(i, view.daily)]));
    expect(progress).toEqual({
      "Instagram に 1 本": { actual: 0, target: 1 },
      "X に 1 本": { actual: 1, target: 1 },
      "どこかに 2 本": { actual: 2, target: 2 },
    });
  });

  it("SNS を持てるのは投稿した回数のやることだけ（DB でも断る）", async () => {
    const { error } = await alice.from("roadmap_items").insert({ project_id: p2, title: "x", week_start: "2026-10-19", kpi: "link_clicks", target: 1, sns: "x" });
    expect(error).not.toBeNull();
  });
});
