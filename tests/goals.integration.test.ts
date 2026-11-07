// 目標（KGI）・中間の目標・KPI（docs/design/goals-model.md）: 前の作りが goals に入らないこと（段階 ④。セキュリティ確認の DB-L1）、権限、
// 書く関数（状態と結果はサーバーが決める）、数える関数、やることのつながり。
// 前の作り（roadmaps・first_month.weekly）からの写し替えと橋渡しは、段階 ④（20261107110000）で消した（写し替えは本番で確かめた。2026-11-07）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadGoals, metricTotal } from "@/lib/goals/load";
import { GoalError, reviseGoal, setGoalActions, setGoalKpis, settleGoal, startGoal, startMilestone } from "@/lib/goals/write";
import { normalizePlan } from "@/lib/plan/schema";
import { addDays, toYmd } from "@/lib/time";
import { weekStartOf } from "@/lib/roadmap/schema";
import { adminClient, deleteUser, signUpNewUser, type TestClient, goalLess } from "./helpers/supabase";

vi.mock("server-only", () => ({}));

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;

const today = toYmd(new Date());
const monday = weekStartOf(today);
const newProject = async (client: TestClient, name = "季節の器") => (await client.from("projects").insert({ name, description: "器の店", target_audience: "30 代" }).select("id").single()).data!.id;
const goalsOf = async (projectId: string) => (await admin.from("goals").select("*").eq("project_id", projectId).order("created_at")).data!;
const kpisOf = async (goalId: string) => (await admin.from("goal_kpis").select("role, metric, action, sns, per_week").eq("goal_id", goalId).order("role").order("position")).data!;
const milestonesOf = async (goalId: string) => (await admin.from("goal_milestones").select("seq, starts_on, ends_on, target, result_value").eq("goal_id", goalId).order("seq")).data!;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("段階 ④ のあと: 前の作りは goals に入らない（セキュリティ確認の DB-L1）", () => {
  it("roadmaps はなく、写し替え・橋渡しの関数もない", async () => {
    expect((await alice.from("roadmaps" as never).select("*").limit(1)).error).not.toBeNull();
    for (const fn of ["sync_goal_from_legacy", "sync_goal_from_legacy_parts", "legacy_date", "legacy_number"]) {
      expect((await admin.rpc(fn as never, {} as never)).error?.code).toBe("PGRST202");
    }
  });

  it("本人がアカウント設計の JSON に週の回数・区切りの始まりを直接書いても、目標の行動の目標と区切りは変わらず、アプリも読まない", async () => {
    const p = await newProject(alice, "直接書く");
    const id = await setGoalActions(alice, p, [{ sns: "x", per_week: 2 }]);
    const before = { kpis: await kpisOf(id), milestones: await milestonesOf(id) };
    const { error } = await alice.rpc("save_account_plan_section", {
      p_project_id: p,
      p_section: "first_month",
      p_value: { goal: "", metrics: "", kpis: [], weekly: { x: 14, threads: 9 }, startedOn: "2020-01-06" } as never,
      p_source: "manual",
    });
    expect(error).toBeNull();
    expect(await kpisOf(id)).toEqual(before.kpis);
    expect(await milestonesOf(id)).toEqual(before.milestones);
    // JSON に残っていても読まない
    const { data } = await alice.from("account_plans").select("data").eq("project_id", p).single();
    expect(normalizePlan(data!.data, "").first_month.weekly).toEqual({});
  });

  it("やることは必ず目標につながる（足すときに省いても、空にしても、いまの目標に入る）", async () => {
    const p = await newProject(alice, "やること");
    const { data: item } = await alice.from("roadmap_items").insert(goalLess({ project_id: p, title: "1 本", week_start: monday })).select("id, goal_id").single();
    expect(item!.goal_id).toEqual(expect.any(String));
    // 空にしても、トリガーがいまの目標に入れ直す（null のまま残らない）
    await admin.from("roadmap_items").update({ goal_id: null as never }).eq("id", item!.id);
    expect((await admin.from("roadmap_items").select("goal_id").eq("id", item!.id).single()).data!.goal_id).toBe(item!.goal_id);
  });
});

describe("権限", () => {
  let projectId: string;
  let goalId: string;
  beforeAll(async () => {
    projectId = await newProject(alice, "権限");
    goalId = await startGoal(alice, projectId, { goal: { statement: "3 か月で予約 30 件", metric: "outcomes", action: "booking", sns: null, target: 30, weeks: 12, provisional: false } }, "manual");
  });

  it("ほかの人は目標・区切り・KPI を読めない", async () => {
    expect((await bob.from("goals").select("id").eq("id", goalId)).data).toEqual([]);
    expect((await bob.from("goal_milestones").select("id").eq("goal_id", goalId)).data).toEqual([]);
    expect((await bob.from("goal_kpis").select("id").eq("goal_id", goalId)).data).toEqual([]);
  });

  it("本人も表には直接書けない（状態・結果はサーバーが決める）", async () => {
    expect((await alice.from("goals").insert({ project_id: projectId, owner_id: aliceId, starts_on: monday })).error).not.toBeNull();
    await alice.from("goals").update({ status: "achieved", result_value: 999 }).eq("id", goalId);
    expect((await goalsOf(projectId))[0]).toMatchObject({ status: "active", result_value: null });
    await alice.from("goal_milestones").update({ result_value: 30 }).eq("goal_id", goalId);
    expect((await milestonesOf(goalId)).every((m) => m.result_value === null)).toBe(true);
    expect((await alice.from("goal_kpis").insert({ goal_id: goalId, owner_id: aliceId, role: "kpi", metric: "link_clicks", per_week: 1 })).error).not.toBeNull();
    expect((await alice.from("goals").delete().eq("id", goalId).select("id")).data ?? []).toEqual([]);
  });

  it("中で使う関数は呼べない。ほかの人のプロジェクトに目標を作れない", async () => {
    expect((await alice.rpc("ensure_active_goal", { p_project_id: projectId, p_owner_id: aliceId, p_starts_on: monday })).error?.code).toBe("42501");
    expect((await alice.rpc("close_goal_internal", { p_goal_id: goalId, p_replacing: true })).error?.code).toBe("42501");
    await expect(startGoal(bob, projectId, { goal: null }, "manual")).rejects.toBeInstanceOf(GoalError);
    await expect(settleGoal(bob, goalId)).rejects.toBeInstanceOf(GoalError);
    await expect(reviseGoal(bob, goalId, { target: 1 })).rejects.toBeInstanceOf(GoalError);
  });

  it("やることは、同じプロジェクトの active な目標にだけつなげる", async () => {
    const bobProject = await newProject(bob, "ほかの人");
    const bobGoal = await startGoal(bob, bobProject, { goal: null }, "manual");
    expect((await alice.from("roadmap_items").insert({ project_id: projectId, title: "x", week_start: monday, goal_id: bobGoal })).error).not.toBeNull();
    // goal_id なし（段階 ② より前のコード）は active な目標に入る
    const { data } = await alice.from("roadmap_items").insert(goalLess({ project_id: projectId, title: "y", week_start: monday })).select("goal_id").single();
    expect(data!.goal_id).toBe(goalId);
  });
});

describe("書く関数", () => {
  let projectId: string;
  let kgiGoalId: string;

  it("KGI まだの目標で初めて KGI を決めると、同じ行に書き入れ、今週の月曜から 12 週・4 週ごとの区切り 3 つ・KPI ができる。KPI に投稿の本数は入れられない", async () => {
    projectId = await newProject(alice, "書く");
    const blank = await setGoalActions(alice, projectId, [{ sns: "x", per_week: 3 }]);
    // KGI まだの期間の区切り（2 週前に始まった）は、先週の日曜で終える
    await admin.from("goal_milestones").insert({ goal_id: blank, owner_id: aliceId, seq: 1, starts_on: addDays(monday, -14), ends_on: addDays(monday, 13) });
    const id = await startGoal(
      alice,
      projectId,
      { goal: { statement: "3 か月で予約 30 件", metric: "outcomes", action: "booking", sns: null, target: 30, weeks: 12, provisional: false }, milestones: [6, 10, 14], kpis: [{ metric: "link_clicks", action: null, sns: null, per_week: 15 }] },
      "ai",
    );
    kgiGoalId = id;
    // 中身のない replaced は残らない（同じ行）
    expect(id).toBe(blank);
    const goals = await goalsOf(projectId);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ id, status: "active", metric: "outcomes", action: "booking", target: 30, starts_on: monday, ends_on: addDays(monday, 83), source: "ai" });
    expect(await milestonesOf(id)).toEqual([
      { seq: 1, starts_on: addDays(monday, -14), ends_on: addDays(monday, -1), target: null, result_value: null },
      { seq: 2, starts_on: monday, ends_on: addDays(monday, 27), target: 6, result_value: null },
      { seq: 3, starts_on: addDays(monday, 28), ends_on: addDays(monday, 55), target: 10, result_value: null },
      { seq: 4, starts_on: addDays(monday, 56), ends_on: addDays(monday, 83), target: 14, result_value: null },
    ]);
    // 行動の目標は引き継ぐ
    expect(await kpisOf(id)).toEqual([
      { role: "action", metric: "posts", action: null, sns: "x", per_week: 3 },
      { role: "kpi", metric: "link_clicks", action: null, sns: null, per_week: 15 },
    ]);
    await expect(setGoalKpis(alice, projectId, [{ metric: "posts" as never, action: null, sns: null, per_week: 1 }])).rejects.toBeInstanceOf(GoalError);
    const four = Array.from({ length: 4 }, () => ({ metric: "link_clicks" as const, action: null, sns: null, per_week: 1 }));
    await expect(setGoalKpis(alice, projectId, four)).rejects.toBeInstanceOf(GoalError);
    expect((await alice.rpc("set_goal_kpis", { p_project_id: projectId, p_role: "kpi", p_kpis: four as never })).error).not.toBeNull();
  });

  it("数える: 手で入れた成果を期間で足し、数えた最後の日を返す。ストアをつないでいなければ「数えていない」", async () => {
    await alice.from("project_outcomes_daily").insert([
      { project_id: projectId, day: monday, action: "booking", count: 2 },
      { project_id: projectId, day: monday, action: "visit", count: 9 },
    ]);
    expect(await metricTotal(alice, projectId, { metric: "outcomes", action: "booking", sns: null }, monday, addDays(monday, 83))).toEqual({ value: 2, countedThrough: monday, available: true });
    expect(await metricTotal(alice, projectId, { metric: "downloads", action: null, sns: null }, monday, today)).toEqual({ value: 0, countedThrough: null, available: false });
    // ほかの人は数えられない（RLS）
    expect((await metricTotal(bob, projectId, { metric: "outcomes", action: "booking", sns: null }, monday, today)).value).toBe(0);
    const view = await loadGoals(alice, projectId);
    expect(view.active!.progress).toMatchObject({ value: 2, target: 30, available: true, countedThrough: monday });
    expect(view.active!.currentProgress).toMatchObject({ value: 2 });
  });

  it("見直す: 文・目標の値と、まだ始まっていない区切りの目標だけ変えられる", async () => {
    const g = { id: kgiGoalId };
    await reviseGoal(alice, g.id, { target: 40, milestones: { 2: 99, 4: 20 } });
    expect((await goalsOf(projectId))[0].target).toBe(40);
    expect((await milestonesOf(g.id)).map((m) => m.target)).toEqual([null, 6, 10, 20]);
    await expect(reviseGoal(alice, g.id, { endsOn: addDays(today, -1) })).rejects.toBeInstanceOf(GoalError);
  });

  it("次の区切りを始めると、いまの区切りは結果を数えて先週で終わり、今週から 4 週の区切りができる", async () => {
    const g = { id: kgiGoalId };
    // いまの区切りを 2 週前に始まっていたことにする（サーバーの権限で）
    await admin.from("goal_milestones").delete().eq("goal_id", g.id);
    await admin.from("goal_milestones").insert({ goal_id: g.id, owner_id: aliceId, seq: 1, starts_on: addDays(monday, -14), ends_on: addDays(monday, 13) });
    await admin.from("project_outcomes_daily").insert({ project_id: projectId, owner_id: aliceId, day: addDays(monday, -7), action: "booking", count: 3 });
    await startMilestone(alice, projectId, 8);
    const ms = await milestonesOf(g.id);
    expect(ms).toHaveLength(2);
    expect(ms[0]).toMatchObject({ seq: 1, ends_on: addDays(monday, -1), result_value: 3 });
    expect(ms[1]).toMatchObject({ seq: 2, starts_on: monday, ends_on: addDays(monday, 27), target: 8, result_value: null });
  });

  it("目標を替えると、届いていれば達成・期限を過ぎていれば期限切れ・どちらでもなければ見直しとして、結果とともに残る", async () => {
    const g = { id: kgiGoalId };
    // 今週以降のまだのやることは新しい目標へ。済み・先週より前のものは前の目標に残る
    const items = await alice
      .from("roadmap_items")
      .insert([
        { project_id: projectId, title: "今週のまだ", week_start: monday, goal_id: g.id, status: "todo" },
        { project_id: projectId, title: "来週のまだ", week_start: addDays(monday, 7), goal_id: g.id, status: "todo" },
        { project_id: projectId, title: "今週の済み", week_start: monday, goal_id: g.id, status: "done" },
        { project_id: projectId, title: "先週のまだ", week_start: addDays(monday, -7), goal_id: g.id, status: "todo" },
      ])
      .select("id, title");
    // 届いた（目標 40 → 2 に見直してから替える。数え始めより前の 3 件は数えない）
    await reviseGoal(alice, g.id, { target: 2 });
    const next = await startGoal(alice, projectId, { goal: { statement: "3 か月で予約 50 件", metric: "outcomes", action: "booking", sns: null, target: 50, weeks: 12, provisional: false } }, "ai");
    expect((await goalsOf(projectId)).find((x) => x.id === g.id)).toMatchObject({ status: "achieved", result_value: 2, closed_at: expect.any(String) });
    const { data: moved } = await admin.from("roadmap_items").select("title, goal_id").in("id", items.data!.map((i) => i.id));
    expect(Object.fromEntries(moved!.map((m) => [m.title, m.goal_id === next ? "新" : m.goal_id === g.id ? "前" : "?"]))).toEqual({ 今週のまだ: "新", 来週のまだ: "新", 今週の済み: "前", 先週のまだ: "前" });
    // 期限を過ぎていた（サーバーの権限で期間を過去にする）
    await admin.from("goals").update({ starts_on: addDays(today, -100), ends_on: addDays(today, -10) }).eq("id", next);
    const third = await settleGoal(alice, next);
    expect((await goalsOf(projectId)).find((x) => x.id === next)).toMatchObject({ status: "expired" });
    // 終えたあとの KGI まだの目標に、次の KGI を書き入れる（同じ行）。届かず期限前に替えると見直し
    const fourth = await startGoal(alice, projectId, { goal: { statement: "SNS から 100 クリック", metric: "link_clicks", action: null, sns: null, target: 100, weeks: 8, provisional: true } }, "ai");
    expect(fourth).toBe(third);
    await startGoal(alice, projectId, { goal: null }, "manual");
    expect((await goalsOf(projectId)).find((x) => x.id === fourth)).toMatchObject({ status: "replaced", result_value: 0 });
    // これまでの目標（新しい順）と、いまの目標は 1 つ
    const view = await loadGoals(alice, projectId);
    expect(view.past.map((p) => p.status)).toEqual(expect.arrayContaining(["achieved", "expired", "replaced"]));
    expect(view.past.some((p) => p.id === third)).toBe(true);
    expect((await goalsOf(projectId)).filter((x) => x.status === "active")).toHaveLength(1);
  });

  it("同時に始めても、active な目標は 1 つ（KGI まだのまま始め直しても行は増えない）", async () => {
    const p = await newProject(alice, "同時");
    await Promise.all(Array.from({ length: 5 }, () => startGoal(alice, p, { goal: null }, "manual")));
    expect(await goalsOf(p)).toHaveLength(1);
    const kgi = { statement: "SNS から 50 クリック", metric: "link_clicks" as const, action: null, sns: null, target: 50, weeks: 12, provisional: false };
    await Promise.all(Array.from({ length: 4 }, () => startGoal(alice, p, { goal: kgi }, "ai")));
    const gs = await goalsOf(p);
    expect(gs.filter((g) => g.status === "active")).toHaveLength(1);
    // 1 回目は書き入れ、残りの 3 回はそれぞれ前を閉じて作る
    expect(gs).toHaveLength(4);
  });

  it("閉じた目標には、やることを新しく足せない（つなぎ直しも同じプロジェクトの目標だけ）", async () => {
    const closed = (await goalsOf(projectId)).find((g) => g.status !== "active")!;
    expect((await alice.from("roadmap_items").insert({ project_id: projectId, title: "z", week_start: monday, goal_id: closed.id })).error).not.toBeNull();
  });
});
