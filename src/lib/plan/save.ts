import type { SupabaseClient } from "@supabase/supabase-js";
import { cycleFromMilestones, hasTargets, mondayOf, withFirstMonthCycle, type WeeklyTargets } from "@/lib/coach/pace";
import { loadGoals } from "@/lib/goals/load";
import { actionsFromWeekly } from "@/lib/goals/schema";
import { GoalError, setGoalActions, startMilestone } from "@/lib/goals/write";
import type { Database } from "@/lib/supabase/database.types";
import { isSnsKey, SNS_KEYS } from "@/lib/sns";
import { toYmd } from "@/lib/time";
import { MAX_WEEKLY_PER_SNS, sectionSchemas, type PlanData, type SectionKey, type SectionValue } from "./schema";

// アカウント設計の 1 セクションを保存する（画面・AI と考える・AI と相談の共通の入口。利用者の権限のクライアントで、RLS で本人のものだけ）。
// 最初の 1 か月（週の回数）の SNS ごとの週の回数は、いまの目標の行動の目標（goal_kpis の action）に書く（docs/design/goals-model.md の 5.）。
// JSON の first_month.weekly と startedOn は前の値のまま残す（変えると前の作りからの橋渡しのトリガーが動くため。段階 ④ で JSON から外す）。
// 1 か月の区切り（中間の目標）は、週の回数を初めて決めたとき・区切りが過ぎたとき・「次の 1 か月を始める」のときに、今週から始める
type Db = SupabaseClient<Database>;

export async function saveSectionValue(
  user: Db,
  projectId: string,
  key: SectionKey,
  value: SectionValue<SectionKey>,
  source: "ai" | "manual",
  opts: { restart?: boolean; now?: Date } = {},
): Promise<{ ok: true } | { ok: false }> {
  let v = value;
  if (key === "first_month") {
    const prev = await loadFirstMonth(user, projectId);
    // 1 か月後の目標の文・判断の仕方・数字（前の作り）は、画面から送らなくなったので前の値を残す（KGI・KPI はロードマップの goals）
    const next = value as PlanData["first_month"];
    v = {
      goal: next.goal || prev?.goal || "",
      metrics: next.metrics || prev?.metrics || "",
      kpis: next.kpis.length ? next.kpis : (prev?.kpis ?? []),
      weekly: prev?.weekly ?? {},
      startedOn: prev?.startedOn ?? null,
    };
  }
  const { error } = await user.rpc("save_account_plan_section", { p_project_id: projectId, p_section: key, p_value: v as never, p_source: source });
  if (error) return { ok: false };
  if (key === "first_month") {
    try {
      await saveWeekly(user, projectId, (value as PlanData["first_month"]).weekly, { restart: opts.restart, now: opts.now });
    } catch (e) {
      if (e instanceof GoalError) return { ok: false };
      throw e;
    }
  }
  return { ok: true };
}

// 週の回数を行動の目標に書き、要れば 1 か月の区切りを今週から始める（終わった区切りの結果は DB が数える）。
// 次の区切りの目標の値は、KGI を決めたときに作った区切りのものを引き継ぐ
export async function saveWeekly(user: Db, projectId: string, weekly: WeeklyTargets, opts: { restart?: boolean; now?: Date } = {}): Promise<void> {
  await setGoalActions(user, projectId, actionsFromWeekly(weekly));
  if (!hasTargets(weekly)) return;
  const today = toYmd(opts.now ?? new Date());
  const { active } = await loadGoals(user, projectId, opts.now);
  const milestones = active?.milestones ?? [];
  const cycle = cycleFromMilestones(milestones, today);
  if (cycle && !cycle.ended && !opts.restart) return;
  const monday = mondayOf(today);
  const next = milestones.filter((m) => m.startsOn >= monday).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0] ?? milestones.find((m) => m.startsOn <= today && today <= m.endsOn);
  await startMilestone(user, projectId, next?.target ?? null);
}

export async function loadFirstMonth(user: Db, projectId: string): Promise<PlanData["first_month"] | null> {
  const { data } = await user.from("account_plans").select("data").eq("project_id", projectId).maybeSingle();
  const raw = (data?.data as Record<string, unknown> | null)?.first_month;
  const parsed = sectionSchemas.first_month.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

type Target = { kpi: string; per_week: number; sns?: string | null };

// ロードマップの毎週の目標に SNS ごとの投稿した回数があれば → 最初の 1 か月の週の回数（伴走が見張る数字）。なければ何もしない。
// 前の作りの書き方（saveGoal だけが使う。JSON に書き、橋渡しのトリガーが行動の目標に写す）。アプリはもう使わない（段階 ③）。橋渡しのテストのために残し、段階 ④ で消す
export async function syncWeeklyFromRoadmap(user: Db, projectId: string, kpiTargets: Target[], source: "ai" | "manual", now = new Date()): Promise<void> {
  const weekly: WeeklyTargets = {};
  for (const t of kpiTargets) {
    if (t.kpi !== "posts" || !isSnsKey(t.sns)) continue;
    const n = Math.min(MAX_WEEKLY_PER_SNS, Math.round(t.per_week));
    if (n >= 1) weekly[t.sns] = n;
  }
  if (!hasTargets(weekly)) return;
  const prev = await loadFirstMonth(user, projectId);
  if (prev && sameWeekly(prev.weekly, weekly)) return;
  const base = prev ?? sectionSchemas.first_month.parse({});
  const v = withFirstMonthCycle({ ...base, weekly }, prev, toYmd(now));
  await user.rpc("save_account_plan_section", { p_project_id: projectId, p_section: "first_month", p_value: v as never, p_source: source });
}

function sameWeekly(a: WeeklyTargets, b: WeeklyTargets): boolean {
  return SNS_KEYS.every((s) => (a[s] ?? 0) === (b[s] ?? 0));
}
