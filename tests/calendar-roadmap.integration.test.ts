// ロードマップのやることをカレンダーに出す（F06・F10。docs/architecture.md の 4.23）。ローカルの Supabase を使う。
// 予定日（その週の中だけ）、投稿とやることの結びつき（同じプロジェクトのやることだけ）、やることの進み具合（週の投稿と結びついた投稿を重ならないように数える）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
// 2026-09-07 は月曜
const WEEK = "2026-09-07";

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let otherProjectId: string;
let bobProjectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "カレンダーとロードマップ" }).select("id").single()).data!.id;
  otherProjectId = (await alice.from("projects").insert({ name: "べつのプロジェクト" }).select("id").single()).data!.id;
  bobProjectId = (await bob.from("projects").insert({ name: "B" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

async function item(fields: { title: string; week_start?: string; kpi?: string | null; target?: number | null; sns?: string | null; project?: string }) {
  const { data, error } = await alice
    .from("roadmap_items")
    .insert({ project_id: fields.project ?? projectId, title: fields.title, week_start: fields.week_start ?? WEEK, kpi: fields.kpi ?? null, target: fields.target ?? null, sns: (fields.sns ?? null) as never })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

// 投稿と配信先を直接入れる（送信済み・予約済み）。日時は UTC
async function post(opts: { sns: string; state: "published" | "scheduled"; at: string; itemId?: string | null; owner?: string; project?: string }) {
  const owner = opts.owner ?? aliceId;
  const { data: p, error } = await admin
    .from("posts")
    .insert({ project_id: opts.project ?? projectId, owner_id: owner, body: "本文", planned_at: opts.at, status: "scheduled", roadmap_item_id: opts.itemId ?? null })
    .select("id")
    .single();
  if (error) throw error;
  const { error: e2 } = await admin.from("post_targets").insert({
    post_id: p.id,
    owner_id: owner,
    sns: opts.sns as never,
    status: opts.state === "published" ? "published" : "pending",
    ...(opts.state === "published" ? { published_at: opts.at } : {}),
  });
  if (e2) throw e2;
  return p.id;
}

async function progress(client: TestClient = alice, project = projectId) {
  const { data, error } = await client.rpc("roadmap_item_progress", { p_project_id: project, p_from: WEEK, p_to: "2026-09-14" });
  if (error) throw error;
  return new Map(data.map((r) => [r.item_id, { published: Number(r.published), scheduled: Number(r.scheduled), linkedPublished: Number(r.linked_published), linkedScheduled: Number(r.linked_scheduled) }]));
}

describe("予定日", () => {
  it("その週の中の日だけ。週を変えると、入らない予定日は外れる", async () => {
    const id = await item({ title: "予定日を決める" });
    expect((await alice.from("roadmap_items").update({ planned_on: "2026-09-09" }).eq("id", id)).error).toBeNull();
    expect((await alice.from("roadmap_items").update({ planned_on: "2026-09-14" }).eq("id", id)).error?.code).toBe("23514");
    expect((await alice.from("roadmap_items").update({ planned_on: "2026-09-06" }).eq("id", id)).error?.code).toBe("23514");
    await alice.from("roadmap_items").update({ week_start: "2026-09-14" }).eq("id", id);
    expect((await alice.from("roadmap_items").select("planned_on").eq("id", id).single()).data!.planned_on).toBeNull();
    // 他人は予定日を変えられない
    await alice.from("roadmap_items").update({ week_start: WEEK, planned_on: "2026-09-10" }).eq("id", id);
    await bob.from("roadmap_items").update({ planned_on: "2026-09-11" }).eq("id", id);
    expect((await alice.from("roadmap_items").select("planned_on").eq("id", id).single()).data!.planned_on).toBe("2026-09-10");
  });
});

describe("投稿とやることの結びつき", () => {
  it("同じプロジェクトのやることだけに結びつけられる（他人・ほかのプロジェクトのやることは指せない）", async () => {
    const id = await item({ title: "結びつける" });
    const otherItem = await item({ title: "べつのプロジェクトのやること", project: otherProjectId });
    const { data: mine } = await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: projectId, p_body: "下書き", p_planned_at: null as unknown as string, p_status: "draft", p_targets: [] });
    expect((await alice.from("posts").update({ roadmap_item_id: id }).eq("id", mine!)).error).toBeNull();
    expect((await alice.from("posts").update({ roadmap_item_id: otherItem }).eq("id", mine!)).error?.code).toBe("23514");
    const { data: bobs } = await bob.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: bobProjectId, p_body: "B の下書き", p_planned_at: null as unknown as string, p_status: "draft", p_targets: [] });
    expect((await bob.from("posts").update({ roadmap_item_id: id }).eq("id", bobs!)).error?.code).toBe("23514");
    // やることを消すと、結びつきだけが外れる（投稿は残る）
    await alice.from("roadmap_items").delete().eq("id", id);
    expect((await alice.from("posts").select("roadmap_item_id").eq("id", mine!).single()).data!.roadmap_item_id).toBeNull();
  });
});

describe("やることの進み具合", () => {
  it("週の投稿（その SNS だけ）と結びついた投稿を、重ならないように数える。結びついた投稿は週のあとでも数える", async () => {
    const ig = await item({ title: "Instagram に 2 本", kpi: "posts", target: 2, sns: "instagram" });
    const any = await item({ title: "すべての SNS で 3 本", kpi: "posts", target: 3 });
    const noKpi = await item({ title: "プロフィールを直したことを投稿する" });
    // 週の中: Instagram（結びつきなし）、X（結びつきなし）、Instagram（ig に結びつき）
    await post({ sns: "instagram", state: "published", at: "2026-09-08T03:00:00Z" });
    await post({ sns: "x", state: "published", at: "2026-09-09T03:00:00Z" });
    await post({ sns: "instagram", state: "published", at: "2026-09-10T03:00:00Z", itemId: ig });
    // 週のあと: ig に結びついた Instagram（遅れて送った）。noKpi に結びついた X の予約
    await post({ sns: "instagram", state: "published", at: "2026-09-16T03:00:00Z", itemId: ig });
    await post({ sns: "x", state: "scheduled", at: "2026-09-20T03:00:00Z", itemId: noKpi });
    // 日本時間で週の前の日（9/6 23:59）は数えない
    await post({ sns: "instagram", state: "published", at: "2026-09-06T14:59:00Z" });

    const m = await progress();
    // Instagram の週の 2 本（うち 1 本は結びつき）＋ 週のあとの結びつき 1 本。結びついた週の中の投稿は 1 回だけ
    expect(m.get(ig)).toEqual({ published: 3, scheduled: 0, linkedPublished: 2, linkedScheduled: 0 });
    // すべての SNS: 週の中の 3 本（ほかのやることに結びついた投稿も、週の投稿として数える）
    expect(m.get(any)).toEqual({ published: 3, scheduled: 0, linkedPublished: 0, linkedScheduled: 0 });
    // 数字のないやることは、結びついた投稿だけ
    expect(m.get(noKpi)).toEqual({ published: 0, scheduled: 1, linkedPublished: 0, linkedScheduled: 1 });
  });

  it("他人のプロジェクトの進み具合は読めない（RLS）", async () => {
    expect((await progress(bob)).size).toBe(0);
    expect((await bob.rpc("roadmap_item_progress", { p_project_id: projectId, p_from: WEEK, p_to: WEEK })).data).toEqual([]);
  });
});
