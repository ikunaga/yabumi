// 目標の画面（段階 ②。docs/design/goals-model.md の 5.）: 手で目標を決める・直す（見直しと新しい目標の分け方、これまでの目標に残る）、
// 前の KGI（投稿の本数）を成果の目標に変える、概要の帯の目標の振り返り（届いた・一度振り返った）、週の回数の保存と 1 か月の区切り
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadGoals } from "@/lib/goals/load";
import { saveManualGoal } from "@/lib/goals/manual";
import { loadGoalReview } from "@/lib/goals/review";
import { isLegacyActionGoal } from "@/lib/goals/schema";
import { setGoalActions } from "@/lib/goals/write";
import { saveWeekly } from "@/lib/plan/save";
import { saveGoal } from "@/lib/roadmap/write";
import { weekStartOf } from "@/lib/roadmap/schema";
import { addDays, toYmd } from "@/lib/time";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

vi.mock("server-only", () => ({}));

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
const today = toYmd(new Date());
const monday = weekStartOf(today);

const newProject = async (name: string) => (await alice.from("projects").insert({ name, description: "器の店", target_audience: "30 代" }).select("id").single()).data!.id;
const booking = (target: number, statement = "3 か月で予約 30 件") => ({ statement, metric: "outcomes" as const, action: "booking" as const, sns: null, target, weeks: 12, provisional: false });

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
});

describe("手で目標を決める・直す", () => {
  let projectId: string;
  let goalId: string;

  it("KGI まだ（週の回数だけ）の目標に初めて決めると、同じ目標に書き入れ、中間の目標と KPI も入る。週の回数は残る", async () => {
    projectId = await newProject("手で決める");
    const first = await setGoalActions(alice, projectId, [{ sns: "x", per_week: 2 }]);
    expect(await saveManualGoal(alice, projectId, { goal: booking(30), milestones: { 1: 6, 2: 10, 3: 14 }, kpis: [{ metric: "link_clicks", action: null, sns: null, per_week: 15 }] })).toBe("started");
    const { active, past } = await loadGoals(alice, projectId);
    goalId = active!.goal.id;
    expect(goalId).toBe(first);
    expect(active!.goal).toMatchObject({ statement: "3 か月で予約 30 件", metric: "outcomes", action: "booking", target: 30, startsOn: monday, endsOn: addDays(monday, 83) });
    expect(active!.milestones.map((m) => [m.seq, m.target])).toEqual([
      [1, 6],
      [2, 10],
      [3, 14],
    ]);
    expect(active!.kpis.map((k) => [k.metric, k.perWeek])).toEqual([["link_clicks", 15]]);
    expect(active!.actions.map((k) => [k.sns, k.perWeek])).toEqual([["x", 2]]);
    expect(past).toEqual([]);
  });

  it("同じ数字のまま直すと見直し（同じ目標）。始まった区切りの目標は変えず、先の区切りだけ変わる", async () => {
    expect(await saveManualGoal(alice, projectId, { goal: booking(40, "3 か月で予約 40 件"), milestones: { 1: 99, 2: 12, 3: null }, kpis: [] })).toBe("revised");
    const { active, past } = await loadGoals(alice, projectId);
    expect(active!.goal).toMatchObject({ id: goalId, statement: "3 か月で予約 40 件", target: 40 });
    expect(active!.milestones.map((m) => [m.seq, m.target])).toEqual([
      [1, 6],
      [2, 12],
      [3, null],
    ]);
    expect(active!.kpis).toEqual([]);
    expect(past).toEqual([]);
  });

  it("数字の種類を変えると新しい目標を始め、前の目標は「見直し」として、これまでの目標に残る。週の回数は引き継ぐ", async () => {
    const goal = { statement: "3 か月でクリック 300 回", metric: "link_clicks" as const, action: null, sns: null, target: 300, weeks: 12, provisional: false };
    expect(await saveManualGoal(alice, projectId, { goal, milestones: {}, kpis: [] })).toBe("started");
    const { active, past } = await loadGoals(alice, projectId);
    expect(active!.goal).toMatchObject({ metric: "link_clicks", target: 300 });
    expect(active!.goal.id).not.toBe(goalId);
    expect(past.map((g) => [g.id, g.status, g.resultValue])).toEqual([[goalId, "replaced", 0]]);
    expect(active!.actions.map((k) => [k.sns, k.perWeek])).toEqual([["x", 2]]);
  });

  it("KGI の文が空なら、KPI だけ入れ替える（目標は変わらない）", async () => {
    const before = (await loadGoals(alice, projectId)).active!.goal.id;
    expect(await saveManualGoal(alice, projectId, { goal: null, milestones: {}, kpis: [{ metric: "views", action: null, sns: null, per_week: 500 }] })).toBe("kpis");
    const { active } = await loadGoals(alice, projectId);
    expect(active!.goal.id).toBe(before);
    expect(active!.kpis.map((k) => k.metric)).toEqual(["views"]);
  });

  it("期限が今日より前になる見直しは断る", async () => {
    const { active } = await loadGoals(alice, projectId);
    await admin.from("goals").update({ starts_on: addDays(monday, -56), ends_on: addDays(monday, 27) }).eq("id", active!.goal.id);
    const goal = { statement: "4 週で", metric: "link_clicks" as const, action: null, sns: null, target: 300, weeks: 4, provisional: false };
    await expect(saveManualGoal(alice, projectId, { goal, milestones: {}, kpis: [] })).rejects.toMatchObject({ userMessage: expect.stringContaining("週の数を増やして") });
  });
});

describe("前の KGI（投稿の本数）", () => {
  it("前のコードで作った投稿の本数の KGI は「成果の目標に変えましょう」の印が付き、成果の目標を決めると、前の目標はこれまでの目標に残る", async () => {
    const projectId = await newProject("ddy と同じ形の KGI");
    await saveGoal(alice, projectId, { kgi: { statement: "4 週間で 12 回投稿する", kpi: "posts", target: 12, deadline: addDays(monday, 27), sns: null }, kpiTargets: [{ kpi: "posts", per_week: 3, sns: "x" }] }, "ai");
    const before = await loadGoals(alice, projectId);
    expect(isLegacyActionGoal(before.active!.goal)).toBe(true);
    expect(await saveManualGoal(alice, projectId, { goal: booking(10, "3 か月で予約 10 件"), milestones: {}, kpis: [] })).toBe("started");
    const after = await loadGoals(alice, projectId);
    expect(isLegacyActionGoal(after.active!.goal)).toBe(false);
    expect(after.past.map((g) => [g.statement, g.metric, g.status])).toEqual([["4 週間で 12 回投稿する", "posts", "replaced"]]);
    expect(after.active!.actions.map((k) => [k.sns, k.perWeek])).toEqual([["x", 3]]);
  });
});

describe("概要の帯の目標の振り返り", () => {
  it("目標に届くと出る。その目標の振り返りの会話を一度終えたら、期限が来るまで出さない（ほかの目標の会話では消えない）", async () => {
    const projectId = await newProject("振り返り");
    await saveManualGoal(alice, projectId, { goal: booking(2, "3 か月で予約 2 件"), milestones: {}, kpis: [] });
    expect(await loadGoalReview(alice, await loadGoals(alice, projectId))).toBeNull();
    await admin.from("project_outcomes_daily").insert({ project_id: projectId, owner_id: aliceId, day: today, action: "booking", count: 2 });
    const goals = await loadGoals(alice, projectId);
    expect(await loadGoalReview(alice, goals)).toMatchObject({ kind: "reached", goal: { id: goals.active!.goal.id } });

    const thread = async (goalId: string, closed: boolean) => {
      // 閉じた会話には発言を足せないので、発言のあとで閉じる
      const { data: t } = await admin.from("ai_threads").insert({ project_id: projectId, owner_id: aliceId, purpose: "consult" }).select("id").single();
      expect((await admin.from("ai_messages").insert({ thread_id: t!.id, owner_id: aliceId, role: "user", content: { kind: "start", topic: "goal_review", goalId } })).error).toBeNull();
      if (closed) await admin.from("ai_threads").update({ closed_at: new Date().toISOString() }).eq("id", t!.id);
    };
    await thread(crypto.randomUUID(), true);
    await thread(goals.active!.goal.id, false);
    expect(await loadGoalReview(alice, goals)).toMatchObject({ kind: "reached" });
    await thread(goals.active!.goal.id, true);
    expect(await loadGoalReview(alice, goals)).toBeNull();

    // 期限が来たら、振り返ったあとでも出す
    await admin.from("goals").update({ starts_on: addDays(monday, -84), ends_on: addDays(monday, -1) }).eq("id", goals.active!.goal.id);
    await admin.from("project_outcomes_daily").delete().eq("project_id", projectId);
    expect(await loadGoalReview(alice, await loadGoals(alice, projectId))).toMatchObject({ kind: "ended" });
  });
});

describe("週の回数の保存と 1 か月の区切り", () => {
  it("区切りが過ぎていたら、保存したときに今週から次の区切りを始め、前の区切りは振り返り済みになる。次の区切りの目標の値は引き継ぐ", async () => {
    const projectId = await newProject("区切り");
    await saveManualGoal(alice, projectId, { goal: booking(30), milestones: { 1: 6, 2: 10, 3: 14 }, kpis: [] });
    await saveWeekly(alice, projectId, { x: 2 });
    const { active } = await loadGoals(alice, projectId);
    // 1 か月目が先週で終わり、2 か月目は今週から（まだ振り返っていない）
    const [m1, m2, m3] = active!.milestones;
    await admin.from("goal_milestones").delete().eq("id", m3.id);
    await admin.from("goal_milestones").update({ starts_on: monday, ends_on: addDays(monday, 27) }).eq("id", m2.id);
    await admin.from("goal_milestones").update({ starts_on: addDays(monday, -28), ends_on: addDays(monday, -1) }).eq("id", m1.id);
    await admin.from("goals").update({ starts_on: addDays(monday, -28) }).eq("id", active!.goal.id);

    await saveWeekly(alice, projectId, { x: 3 });
    const after = (await loadGoals(alice, projectId)).active!;
    expect(after.actions.map((k) => [k.sns, k.perWeek])).toEqual([["x", 3]]);
    expect(after.milestones.map((m) => [m.seq, m.startsOn, m.target, m.settledAt !== null])).toEqual([
      [1, addDays(monday, -28), 6, true],
      [2, monday, 10, false],
    ]);
  });
});
