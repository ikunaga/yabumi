// 伴走（F18、決定 D29。docs/architecture.md の 4.27）: RLS と権限、毎日のジョブ（ペース・声かけ・二重に送らない）、
// 配信の停止、最初の 1 か月とロードマップの週の目標のつながり。メールとスマホの通知は偽物を渡し、外には送らない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runCoachJob } from "@/lib/coach/job";
import { loadCoachView } from "@/lib/coach/load";
import { saveSectionValue } from "@/lib/plan/save";
import { sectionSchemas } from "@/lib/plan/schema";
import { saveGoal } from "@/lib/roadmap/write";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

// 2026-10-12 は月曜。水曜の朝 7 時（日本時間）= UTC 火曜 22 時
const WED = new Date("2026-10-13T22:00:00Z");
const NEXT_MON = new Date("2026-10-18T22:00:00Z");

const mails: { to: string; subject: string; headers?: Record<string, string> }[] = [];
const pushes: { userId: string; title: string; tag?: string }[] = [];
const deps = {
  mail: {
    apiKey: "test",
    fetch: (async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      mails.push({ to: b.to[0], subject: b.subject, headers: b.headers });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  },
  push: async (_a: unknown, userId: string, msg: { title: string; tag?: string }) => {
    pushes.push({ userId, title: msg.title, tag: msg.tag });
    return { sent: 1, removed: 0, failed: 0 };
  },
};

const firstMonth = (weekly: Record<string, number>) => ({ ...sectionSchemas.first_month.parse({}), goal: "4 週間続ける", weekly });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "伴走のテスト" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("最初の 1 か月の週の回数", () => {
  it("初めて決めると今週の月曜から数え始める。ロードマップがあれば、毎週の目標の SNS ごとの投稿した回数に写す", async () => {
    await saveGoal(alice, projectId, { kgi: null, kpiTargets: [{ kpi: "link_clicks", per_week: 2, sns: null }] }, "manual", new Date("2026-10-12T03:00:00Z"));
    const r = await saveSectionValue(alice, projectId, "first_month", firstMonth({ x: 2, instagram: 1 }), "manual", { now: new Date("2026-10-12T03:00:00Z") });
    expect(r.ok).toBe(true);
    const { data } = await alice.from("account_plans").select("data").eq("project_id", projectId).single();
    expect((data!.data as { first_month: unknown }).first_month).toMatchObject({ weekly: { x: 2, instagram: 1 }, startedOn: "2026-10-12" });
    const { data: rm } = await alice.from("roadmaps").select("kpi_targets").eq("project_id", projectId).single();
    expect(rm!.kpi_targets).toEqual([
      { kpi: "posts", per_week: 2, sns: "x" },
      { kpi: "posts", per_week: 1, sns: "instagram" },
      { kpi: "link_clicks", per_week: 2, sns: null },
    ]);
  });

  it("ロードマップで SNS ごとの投稿した回数を変えると、最初の 1 か月の週の回数も揃う（数え始めは変えない）", async () => {
    await saveGoal(alice, projectId, { kgi: null, kpiTargets: [{ kpi: "posts", per_week: 3, sns: "x" }, { kpi: "posts", per_week: 1, sns: "instagram" }] }, "manual", new Date("2026-10-13T03:00:00Z"));
    const { data } = await alice.from("account_plans").select("data").eq("project_id", projectId).single();
    expect((data!.data as { first_month: unknown }).first_month).toMatchObject({ weekly: { x: 3, instagram: 1 }, startedOn: "2026-10-12" });
    // 元に戻す（以下のテストは X 2・Instagram 1）
    await saveSectionValue(alice, projectId, "first_month", firstMonth({ x: 2, instagram: 1 }), "manual", { now: new Date("2026-10-13T03:00:00Z") });
  });
});

describe("毎日のジョブと声かけ", () => {
  beforeAll(async () => {
    // 今週: X に 1 本送った（月曜）、Instagram はまだ
    const { data: post } = await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "送った", status: "scheduled", planned_at: "2026-10-12T03:00:00Z" }).select("id").single();
    await admin.from("post_targets").insert({ post_id: post!.id, owner_id: aliceId, sns: "x", status: "published", published_at: "2026-10-12T03:00:00Z" });
  });

  it("画面: 今週あと X 1 本・Instagram 1 本。水曜で Instagram は遅れそう", async () => {
    const view = (await loadCoachView(alice, projectId, { now: WED }))!;
    expect(view.thisWeek).toBe("2026-10-12");
    expect(view.week.rows.map((r) => [r.sns, r.published, r.status])).toEqual([
      ["x", 1, "not_yet"],
      ["instagram", 0, "behind"],
    ]);
    expect(view.cycle).toMatchObject({ weekIndex: 1, ended: false });
  });

  it("水曜の朝: 遅れそうの知らせをメールとスマホに送り、今週の結果を書く。2 回目は二重に送らない", async () => {
    const out = await runCoachJob(admin, { now: WED, appUrl: "https://yabumi.test", deps, ownerId: aliceId });
    expect(out).toEqual([{ projectId, behind: { email: "sent", push: "sent" } }]);
    expect(mails.at(-1)!.subject).toBe("今週の投稿、あと X 1 本・Instagram 1 本です（伴走のテスト）");
    expect(mails.at(-1)!.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(pushes.at(-1)).toMatchObject({ userId: aliceId, tag: `pace:${projectId}` });
    const { data: week } = await admin.from("pace_weeks").select("week_start, targets, published, achieved").eq("project_id", projectId);
    expect(week).toEqual([{ week_start: "2026-10-12", targets: { x: 2, instagram: 1 }, published: { x: 1 }, achieved: false }]);

    const again = await runCoachJob(admin, { now: WED, appUrl: "https://yabumi.test", deps, ownerId: aliceId });
    expect(again[0].behind).toEqual({ email: "dup", push: "dup" });
  });

  it("「毎週の振り返りだけ」なら遅れの知らせは送らない。メールが送れなかったら記録を消して次の回に送る", async () => {
    await admin.from("notification_log").delete().eq("user_id", aliceId);
    await alice.from("notification_prefs").update({ email_mode: "weekly", push_mode: "off" }).eq("user_id", aliceId);
    const out = await runCoachJob(admin, { now: WED, deps, ownerId: aliceId });
    expect(out[0].behind).toEqual({ email: "off", push: "off" });

    await alice.from("notification_prefs").update({ email_mode: "weekly_and_behind" }).eq("user_id", aliceId);
    const failing = { ...deps, mail: { apiKey: "test", fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch } };
    const failed = await runCoachJob(admin, { now: WED, deps: failing, ownerId: aliceId });
    expect(failed[0].behind!.email).toBe("failed");
    const { count } = await admin.from("notification_log").select("id", { count: "exact", head: true }).eq("user_id", aliceId);
    expect(count).toBe(0);
    await alice.from("notification_prefs").update({ push_mode: "weekly_and_behind" }).eq("user_id", aliceId);
  });

  it("次の月曜: 先週の結果（届かなかった）を書き、振り返りを送る。今週の行も作る", async () => {
    const out = await runCoachJob(admin, { now: NEXT_MON, appUrl: "https://yabumi.test", deps, ownerId: aliceId });
    expect(out[0].weekly).toEqual({ email: "sent", push: "sent" });
    expect(mails.at(-1)!.subject).toBe("先週の振り返りと今週の目標（伴走のテスト）");
    const { data } = await admin.from("pace_weeks").select("week_start, achieved").eq("project_id", projectId).order("week_start");
    expect(data).toEqual([
      { week_start: "2026-10-12", achieved: false },
      { week_start: "2026-10-19", achieved: false },
    ]);
  });
});

describe("配信の停止と RLS", () => {
  it("メールの合言葉で止められる（メールだけ）。合言葉は本人にも書き換えられない", async () => {
    const { data: p } = await alice.from("notification_prefs").select("unsubscribe_token, email_mode, push_mode").single();
    expect(p!.email_mode).toBe("weekly_and_behind");
    const { error } = await alice.from("notification_prefs").update({ unsubscribe_token: crypto.randomUUID() } as never).eq("user_id", aliceId);
    expect(error).not.toBeNull();
    await admin.from("notification_prefs").update({ email_mode: "off" }).eq("unsubscribe_token", p!.unsubscribe_token);
    const { data: after } = await alice.from("notification_prefs").select("email_mode, push_mode").single();
    expect(after).toEqual({ email_mode: "off", push_mode: "weekly_and_behind" });
  });

  it("ほかの人は、設定・送った記録・週の結果を読めない。本人も送った記録は読めず、週の結果は書けない。ログインしていない人は何もできない", async () => {
    expect((await bob.from("notification_prefs").select("user_id").eq("user_id", aliceId)).data).toEqual([]);
    expect((await bob.from("pace_weeks").select("week_start").eq("project_id", projectId)).data).toEqual([]);
    expect((await alice.from("pace_weeks").select("week_start").eq("project_id", projectId)).data!.length).toBe(2);
    expect((await alice.from("notification_log").select("id")).error?.code).toBe("42501");
    expect((await alice.from("pace_weeks").insert({ project_id: projectId, owner_id: aliceId, week_start: "2026-10-26", targets: {} })).error).not.toBeNull();
    expect((await bob.from("notification_prefs").insert({ user_id: aliceId })).error).not.toBeNull();
    expect((await anonClient().from("notification_prefs").select("user_id").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("pace_weeks").select("week_start").limit(1)).error?.code).toBe("42501");
  });
});

describe("予定日を過ぎたやること（ロードマップ）", () => {
  let carol: TestClient;
  let carolId: string;
  let p3: string;
  let itemId: string;
  // 木曜の朝 7 時（遅れの声かけの曜日ではない日）
  const THU = new Date("2026-10-14T22:00:00Z");

  beforeAll(async () => {
    ({ client: carol, userId: carolId } = await signUpNewUser());
    p3 = (await carol.from("projects").insert({ name: "予定日のテスト" }).select("id").single()).data!.id;
    const { data, error: insertError } = await carol
      .from("roadmap_items")
      .insert([
        { project_id: p3, title: "Instagram に作品の感想を 1 本", week_start: "2026-10-12", planned_on: "2026-10-13", kpi: "posts", target: 1, sns: "instagram", status: "todo" },
        // 予約した投稿を結びつけたもの（過ぎたことにしない）
        { project_id: p3, title: "X に開発の話", week_start: "2026-10-12", planned_on: "2026-10-13", kpi: null, target: null, sns: null, status: "todo" },
        // 済んだもの・予定日がまだのもの・7 日より前のものも知らせない
        { project_id: p3, title: "済んだ", week_start: "2026-10-12", planned_on: "2026-10-12", kpi: null, target: null, sns: null, status: "done" },
        { project_id: p3, title: "まだ先", week_start: "2026-10-12", planned_on: "2026-10-16", kpi: null, target: null, sns: null, status: "todo" },
        { project_id: p3, title: "ずっと前", week_start: "2026-09-28", planned_on: "2026-09-30", kpi: null, target: null, sns: null, status: "todo" },
      ])
      .select("id, title");
    if (!data) throw new Error(JSON.stringify(insertError));
    itemId = data!.find((r) => r.title.startsWith("Instagram"))!.id;
    const linked = data!.find((r) => r.title.startsWith("X に"))!.id;
    const { data: post } = await admin.from("posts").insert({ project_id: p3, owner_id: carolId, body: "予約", status: "scheduled", planned_at: "2026-10-16T03:00:00Z", roadmap_item_id: linked }).select("id").single();
    await admin.from("post_targets").insert({ post_id: post!.id, owner_id: carolId, sns: "x", status: "pending" });
  });

  afterAll(async () => {
    await deleteUser(carolId);
  });

  it("週の回数を決めていなくても、予定日を過ぎたのに投稿のないやることを、1 通にまとめて 1 回だけ知らせる", async () => {
    const out = await runCoachJob(admin, { now: THU, appUrl: "https://yabumi.test", deps, ownerId: carolId });
    expect(out).toEqual([{ projectId: p3, overdue: { email: "sent", push: "sent" } }]);
    expect(mails.at(-1)!.subject).toBe("予定日を過ぎたやることが 1 件あります（予定日のテスト）");
    const { data: log } = await admin.from("notification_log").select("kind, period_key, channel").eq("user_id", carolId).order("channel");
    expect(log).toEqual([
      { kind: "overdue", period_key: itemId, channel: "email" },
      { kind: "overdue", period_key: itemId, channel: "push" },
    ]);
    const again = await runCoachJob(admin, { now: new Date("2026-10-15T22:00:00Z"), deps, ownerId: carolId });
    expect(again).toEqual([{ projectId: p3 }]);
  });

  it("「毎週の振り返りだけ」の人には送らない", async () => {
    await admin.from("notification_log").delete().eq("user_id", carolId);
    await carol.from("notification_prefs").update({ email_mode: "weekly", push_mode: "off" }).eq("user_id", carolId);
    const out = await runCoachJob(admin, { now: THU, deps, ownerId: carolId });
    expect(out).toEqual([{ projectId: p3 }]);
  });
});
