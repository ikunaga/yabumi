// 目標（KGI）・中間の目標・KPI の作り直し（段階 ①。docs/design/goals-model.md）: 前の作りからの写し替え（ddy と同じ形）、橋渡し、権限、
// 書く関数（状態と結果はサーバーが決める）、数える関数、やることのつながり
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadGoals, metricTotal } from "@/lib/goals/load";
import { weeklyTargetsOf, isLegacyActionGoal } from "@/lib/goals/schema";
import { GoalError, reviseGoal, setGoalActions, setGoalKpis, settleGoal, startGoal, startMilestone } from "@/lib/goals/write";
import { saveSectionValue } from "@/lib/plan/save";
import { sectionSchemas } from "@/lib/plan/schema";
import { addItems, saveGoal } from "@/lib/roadmap/write";
import { addDays, toYmd } from "@/lib/time";
import { weekStartOf } from "@/lib/roadmap/schema";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

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

describe("前の作りからの写し替え（ddy と同じ形）", () => {
  let projectId: string;

  it("前のコードで書いた KGI（投稿の本数）・SNS ごとの毎週の目標・週の回数・区切り・やることが、active な目標に写る", async () => {
    projectId = await newProject(alice, "ddy と同じ形");
    const started = addDays(monday, -14);
    // ロードマップ（前のコード）: KGI は投稿の本数、毎週の目標は SNS ごとの投稿とクリック
    await saveGoal(
      alice,
      projectId,
      {
        kgi: { statement: "4 週間で 12 回投稿する", kpi: "posts", target: 12, deadline: addDays(started, 27), sns: null },
        kpiTargets: [
          { kpi: "posts", per_week: 2, sns: "x" },
          { kpi: "posts", per_week: 1, sns: "threads" },
          { kpi: "posts", per_week: 1, sns: "instagram" },
          { kpi: "link_clicks", per_week: 5, sns: null },
        ],
      },
      "ai",
      new Date(`${started}T03:00:00Z`),
    );
    // アカウント設計の最初の 1 か月（前のコード）: 週の回数と区切りの始まり
    const fm = { ...sectionSchemas.first_month.parse({}), goal: "4 週間で 12 回投稿する", weekly: { x: 3, threads: 1, instagram: 2 } };
    expect((await saveSectionValue(alice, projectId, "first_month", fm, "manual", { now: new Date(`${started}T03:00:00Z`) })).ok).toBe(true);
    // やることが複数
    await addItems(alice, projectId, [
      { title: "柱「季節の器」で 1 本書く", detail: "", week_start: monday, kpi: "posts", target: 1, sns: "x", kind: "post" },
      { title: "土曜に数字を見る", detail: "", week_start: monday, kpi: null, target: null, sns: null, kind: "review" },
      { title: "来週の 1 本", detail: "", week_start: addDays(monday, 7), kpi: null, target: null, sns: null, kind: "post" },
    ], "ai");
    // 形の合わない SNS の名前（前のデータに混じっていたら写さない。アプリを通さずに書く）
    const { data: plan } = await admin.from("account_plans").select("data").eq("project_id", projectId).single();
    const data = plan!.data as { first_month: Record<string, unknown> };
    await admin.from("account_plans").update({ data: { ...data, first_month: { ...data.first_month, weekly: { x: 3, threads: 1, instagram: 2, myspace: 4, mastodon: "2" } } } as never }).eq("project_id", projectId);
    const { data: rm } = await admin.from("roadmaps").select("kpi_targets").eq("project_id", projectId).single();
    await admin.from("roadmaps").update({ kpi_targets: [...(rm!.kpi_targets as object[]), { kpi: "views", per_week: 100, sns: "unknown_sns" }] as never }).eq("project_id", projectId);

    // マイグレーションの写し替えと同じ関数を、このプロジェクトに流す（何度流しても同じ）
    for (let i = 0; i < 2; i++) expect((await admin.rpc("sync_goal_from_legacy", { p_project_id: projectId })).error).toBeNull();

    const goals = await goalsOf(projectId);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ status: "active", statement: "4 週間で 12 回投稿する", metric: "posts", target: 12, starts_on: started, ends_on: addDays(started, 27), source: "ai", owner_id: aliceId });
    // 行動の目標は、伴走が読んでいる週の回数（形の合わない SNS は写さない）。KPI はクリックと閲覧（SNS の名前が合わないので、すべての SNS）
    expect(await kpisOf(goals[0].id)).toEqual([
      { role: "action", metric: "posts", action: null, sns: "x", per_week: 3 },
      { role: "action", metric: "posts", action: null, sns: "threads", per_week: 1 },
      { role: "action", metric: "posts", action: null, sns: "instagram", per_week: 2 },
      { role: "kpi", metric: "link_clicks", action: null, sns: null, per_week: 5 },
      { role: "kpi", metric: "views", action: null, sns: null, per_week: 100 },
    ]);
    // 区切りの始まり（first_month.startedOn）が 1 つ目の区切り
    const { data: plan2 } = await admin.from("account_plans").select("data").eq("project_id", projectId).single();
    const startedOn = (plan2!.data as { first_month: { startedOn: string } }).first_month.startedOn;
    expect(await milestonesOf(goals[0].id)).toEqual([{ seq: 1, starts_on: startedOn, ends_on: addDays(startedOn, 27), target: null, result_value: null }]);
    // やることは、すべてその目標につながる
    const { data: items } = await admin.from("roadmap_items").select("goal_id").eq("project_id", projectId);
    expect(items).toHaveLength(3);
    expect(items!.every((i) => i.goal_id === goals[0].id)).toBe(true);
    // roadmaps と account_plans は変わらない（写すだけ）
    expect((await admin.from("roadmaps").select("kgi").eq("project_id", projectId).single()).data!.kgi).toMatchObject({ kpi: "posts", target: 12 });
  });

  it("読み込み: 前の KGI（投稿の本数）だと分かり、伴走の週の回数が行動の目標から読める", async () => {
    const view = await loadGoals(alice, projectId);
    expect(view.active).not.toBeNull();
    expect(isLegacyActionGoal(view.active!.goal)).toBe(true);
    expect(weeklyTargetsOf(view.active!.actions)).toEqual({ x: 3, threads: 1, instagram: 2 });
    expect(view.active!.kpis.map((k) => k.metric)).toEqual(["link_clicks", "views"]);
    expect(view.past).toEqual([]);
  });

  it("橋渡し: 前のコードで週の回数を変えると、行動の目標もそろう", async () => {
    const fm = { ...sectionSchemas.first_month.parse({}), goal: "続ける", weekly: { x: 1 } };
    expect((await saveSectionValue(alice, projectId, "first_month", fm, "manual")).ok).toBe(true);
    const [g] = await goalsOf(projectId);
    expect((await kpisOf(g.id)).filter((k) => k.role === "action")).toEqual([{ role: "action", metric: "posts", action: null, sns: "x", per_week: 1 }]);
  });

  it("20261106150100 は 150000 と同じ写し替えの関数を作り直すだけ（続けて当てても結果が同じ）", () => {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const body = (file: string) => {
      const s = fs.readFileSync(path.join(dir, file), "utf8");
      const a = s.search(/create (or replace )?function public\.sync_goal_from_legacy/);
      const b = s.indexOf("revoke all on function public.sync_goal_from_legacy(uuid)", a);
      return s.slice(a, b).replace(/^create (or replace )?function/, "create function");
    };
    expect(body("20261106150100_goals_sns_key.sql")).toBe(body("20261106150000_goals.sql"));
    expect(body("20261106150000_goals.sql")).not.toContain("enum_range");
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
    expect((await alice.rpc("sync_goal_from_legacy", { p_project_id: projectId })).error?.code).toBe("42501");
    await expect(startGoal(bob, projectId, { goal: null }, "manual")).rejects.toBeInstanceOf(GoalError);
    await expect(settleGoal(bob, goalId)).rejects.toBeInstanceOf(GoalError);
    await expect(reviseGoal(bob, goalId, { target: 1 })).rejects.toBeInstanceOf(GoalError);
  });

  it("やることは、同じプロジェクトの active な目標にだけつなげる", async () => {
    const bobProject = await newProject(bob, "ほかの人");
    const bobGoal = await startGoal(bob, bobProject, { goal: null }, "manual");
    expect((await alice.from("roadmap_items").insert({ project_id: projectId, title: "x", week_start: monday, goal_id: bobGoal })).error).not.toBeNull();
    // goal_id なし（段階 ② より前のコード）は active な目標に入る
    const { data } = await alice.from("roadmap_items").insert({ project_id: projectId, title: "y", week_start: monday }).select("goal_id").single();
    expect(data!.goal_id).toBe(goalId);
  });
});

describe("書く関数", () => {
  let projectId: string;

  it("KGI を始めると、今週の月曜から 12 週・4 週ごとの区切り 3 つ・KPI ができる。KPI に投稿の本数は入れられない", async () => {
    projectId = await newProject(alice, "書く");
    await setGoalActions(alice, projectId, [{ sns: "x", per_week: 3 }]);
    const id = await startGoal(
      alice,
      projectId,
      { goal: { statement: "3 か月で予約 30 件", metric: "outcomes", action: "booking", sns: null, target: 30, weeks: 12, provisional: false }, milestones: [6, 10, 14], kpis: [{ metric: "link_clicks", action: null, sns: null, per_week: 15 }] },
      "ai",
    );
    const [first, g] = await goalsOf(projectId);
    // KGI まだの目標（週の回数だけ）は、見直し（replaced）として残る
    expect(first).toMatchObject({ status: "replaced", metric: null, result_value: null });
    expect(g).toMatchObject({ id, status: "active", metric: "outcomes", action: "booking", target: 30, starts_on: monday, ends_on: addDays(monday, 83), source: "ai" });
    expect(await milestonesOf(id)).toEqual([
      { seq: 1, starts_on: monday, ends_on: addDays(monday, 27), target: 6, result_value: null },
      { seq: 2, starts_on: addDays(monday, 28), ends_on: addDays(monday, 55), target: 10, result_value: null },
      { seq: 3, starts_on: addDays(monday, 56), ends_on: addDays(monday, 83), target: 14, result_value: null },
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
    const [, g] = await goalsOf(projectId);
    await reviseGoal(alice, g.id, { target: 40, milestones: { 1: 99, 3: 20 } });
    expect((await goalsOf(projectId))[1].target).toBe(40);
    expect((await milestonesOf(g.id)).map((m) => m.target)).toEqual([6, 10, 20]);
    await expect(reviseGoal(alice, g.id, { endsOn: addDays(today, -1) })).rejects.toBeInstanceOf(GoalError);
  });

  it("次の区切りを始めると、いまの区切りは結果を数えて先週で終わり、今週から 4 週の区切りができる", async () => {
    const [, g] = await goalsOf(projectId);
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
    const [, g] = await goalsOf(projectId);
    // 届いた（目標 40 → 2 に見直してから替える。数え始めより前の 3 件は数えない）
    await reviseGoal(alice, g.id, { target: 2 });
    const next = await startGoal(alice, projectId, { goal: { statement: "3 か月で予約 50 件", metric: "outcomes", action: "booking", sns: null, target: 50, weeks: 12, provisional: false } }, "ai");
    expect((await goalsOf(projectId)).find((x) => x.id === g.id)).toMatchObject({ status: "achieved", result_value: 2, closed_at: expect.any(String) });
    // 期限を過ぎていた（サーバーの権限で期間を過去にする）
    await admin.from("goals").update({ starts_on: addDays(today, -100), ends_on: addDays(today, -10) }).eq("id", next);
    const third = await settleGoal(alice, next);
    expect((await goalsOf(projectId)).find((x) => x.id === next)).toMatchObject({ status: "expired" });
    // 届かず期限前に替えた
    const fourth = await startGoal(alice, projectId, { goal: { statement: "SNS から 100 クリック", metric: "link_clicks", action: null, sns: null, target: 100, weeks: 8, provisional: true } }, "ai");
    await startGoal(alice, projectId, { goal: null }, "manual");
    expect((await goalsOf(projectId)).find((x) => x.id === fourth)).toMatchObject({ status: "replaced", result_value: 0 });
    // これまでの目標（新しい順）と、いまの目標は 1 つ
    const view = await loadGoals(alice, projectId);
    expect(view.past.map((p) => p.status)).toEqual(expect.arrayContaining(["achieved", "expired", "replaced"]));
    expect(view.past.some((p) => p.id === third)).toBe(true);
    expect((await goalsOf(projectId)).filter((x) => x.status === "active")).toHaveLength(1);
  });

  it("同時に始めても、active な目標は 1 つ", async () => {
    const p = await newProject(alice, "同時");
    await Promise.all(Array.from({ length: 5 }, () => startGoal(alice, p, { goal: null }, "manual")));
    const gs = await goalsOf(p);
    expect(gs).toHaveLength(5);
    expect(gs.filter((g) => g.status === "active")).toHaveLength(1);
  });

  it("閉じた目標には、やることを新しく足せない（つなぎ直しも同じプロジェクトの目標だけ）", async () => {
    const closed = (await goalsOf(projectId)).find((g) => g.status !== "active")!;
    expect((await alice.from("roadmap_items").insert({ project_id: projectId, title: "z", week_start: monday, goal_id: closed.id })).error).not.toBeNull();
  });
});
