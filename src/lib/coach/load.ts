import type { SupabaseClient } from "@supabase/supabase-js";
import { loadGoals, type GoalsView } from "@/lib/goals/load";
import { weeklyTargetsOf } from "@/lib/goals/schema";
import { isSnsKey, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";
import {
  computeWeekPace,
  cycleFromMilestones,
  CYCLE_WEEKS,
  DEFAULT_BEHIND_WEEKDAY,
  hasTargets,
  mondayOf,
  streakWeeks,
  type CycleInfo,
  type SnsCounts,
  type WeekPace,
  type WeeklyTargets,
} from "./pace";

// 伴走の画面の読み込み（概要の声かけ、カレンダー、AI と相談）。RLS で本人のものだけ。数は DB の post_counts_by_day（4.23 の 1 か所の数え方）。
// 週の回数はいまの目標の行動の目標（goal_kpis の action）、1 か月の区切りは中間の目標（goal_milestones）から読む（docs/design/goals-model.md）
type Db = SupabaseClient<Database>;

export type CycleWeek = { weekStart: string; targets: WeeklyTargets; published: Partial<Record<SnsKey, number>>; achieved: boolean; current: boolean };

export type CoachView = {
  today: string;
  thisWeek: string;
  targets: WeeklyTargets;
  week: WeekPace;
  streak: number;
  cycle: (CycleInfo & { weeks: CycleWeek[] }) | null;
};

// 続けた週を数えるのにさかのぼる週の数
const LOOKBACK_WEEKS = 12;

// 日ごと・SNS ごとの数を、週ごとにまとめる
export function countsByWeek(rows: { day: string; sns: string; published: number | string; scheduled: number | string }[]): Map<string, SnsCounts> {
  const out = new Map<string, SnsCounts>();
  for (const r of rows) {
    if (!isSnsKey(r.sns)) continue;
    const w = mondayOf(r.day);
    const m = out.get(w) ?? {};
    const c = m[r.sns] ?? { published: 0, scheduled: 0 };
    m[r.sns] = { published: c.published + Number(r.published), scheduled: c.scheduled + Number(r.scheduled) };
    out.set(w, m);
  }
  return out;
}

function publishedOnly(c: SnsCounts | undefined): Partial<Record<SnsKey, number>> {
  const out: Partial<Record<SnsKey, number>> = {};
  for (const s of SNS_KEYS) if (c?.[s]?.published) out[s] = c[s]!.published;
  return out;
}

function achievedWith(targets: WeeklyTargets, published: Partial<Record<SnsKey, number>>): boolean {
  const keys = SNS_KEYS.filter((s) => (targets[s] ?? 0) > 0);
  return keys.length > 0 && keys.every((s) => (published[s] ?? 0) >= targets[s]!);
}

export function parseTargets(raw: unknown): WeeklyTargets {
  const out: WeeklyTargets = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isSnsKey(k) && typeof v === "number" && v > 0) out[k] = v;
  return out;
}

// goals: 呼ぶ側がもう読んだ目標（なければここで読む）
export async function loadCoachView(db: Db, projectId: string, opts: { now?: Date; behindWeekday?: number; goals?: GoalsView } = {}): Promise<CoachView | null> {
  const today = toYmd(opts.now ?? new Date());
  const goals = opts.goals ?? (await loadGoals(db, projectId, opts.now));
  const targets = weeklyTargetsOf(goals.active?.actions ?? []);
  if (!hasTargets(targets)) return null;
  const info = cycleFromMilestones(goals.active?.milestones ?? [], today);
  const thisWeek = mondayOf(today);
  const from = [info?.startedOn, addDays(thisWeek, -7 * LOOKBACK_WEEKS)].filter((d): d is string => Boolean(d)).sort()[0];
  const [{ data: counts, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    db.rpc("post_counts_by_day", { p_project_id: projectId, p_from: from, p_to: addDays(thisWeek, 6) }),
    db.from("pace_weeks").select("week_start, targets, published, achieved").eq("project_id", projectId).gte("week_start", from),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const byWeek = countsByWeek(counts ?? []);
  const saved = new Map((rows ?? []).map((r) => [r.week_start, r]));

  // 終わった週: 毎日のジョブが書いた結果（その週の目標で）を使い、なければ今の目標で数える
  const startWeek = info ? mondayOf(info.startedOn) : null;
  const pastWeek = (w: string): CycleWeek => {
    const r = saved.get(w);
    const weekTargets = r ? parseTargets(r.targets) : targets;
    const published = r ? (parseTargets(r.published) as Partial<Record<SnsKey, number>>) : publishedOnly(byWeek.get(w));
    return { weekStart: w, targets: weekTargets, published, achieved: r ? r.achieved : achievedWith(weekTargets, published), current: false };
  };
  const past: CycleWeek[] = [];
  for (let w = addDays(thisWeek, -7); w >= from && (!startWeek || w >= startWeek); w = addDays(w, -7)) past.push(pastWeek(w));

  const week = computeWeekPace({ targets, counts: byWeek.get(thisWeek) ?? {}, today, weekStart: thisWeek, behindWeekday: opts.behindWeekday ?? DEFAULT_BEHIND_WEEKDAY });
  const streak = streakWeeks(past, thisWeek, week.achieved);

  let cycle: CoachView["cycle"] = null;
  if (info) {
    const weeks: CycleWeek[] = [];
    for (let i = 0; i < CYCLE_WEEKS; i++) {
      const w = addDays(mondayOf(info.startedOn), i * 7);
      if (w > thisWeek || w > info.endsOn) break;
      weeks.push(w === thisWeek ? { weekStart: w, targets, published: publishedOnly(byWeek.get(w)), achieved: week.achieved, current: true } : (past.find((p) => p.weekStart === w) ?? pastWeek(w)));
    }
    cycle = { ...info, weeks };
  }
  return { today, thisWeek, targets, week, streak, cycle };
}
