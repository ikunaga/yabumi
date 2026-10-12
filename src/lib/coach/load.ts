import type { SupabaseClient } from "@supabase/supabase-js";
import { sectionSchemas, type PlanData } from "@/lib/plan/schema";
import { isSnsKey, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";
import {
  computeWeekPace,
  cycleInfo,
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

// 伴走の画面の読み込み（概要の声かけ、ロードマップ）。RLS で本人のものだけ。数は DB の post_counts_by_day（4.23 の 1 か所の数え方）
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

export async function loadCoachView(db: Db, projectId: string, opts: { now?: Date; behindWeekday?: number; firstMonth?: PlanData["first_month"] | null } = {}): Promise<CoachView | null> {
  let fm = opts.firstMonth;
  if (fm === undefined) {
    const { data } = await db.from("account_plans").select("data").eq("project_id", projectId).maybeSingle();
    const parsed = sectionSchemas.first_month.safeParse((data?.data as Record<string, unknown> | null)?.first_month ?? {});
    fm = parsed.success ? parsed.data : null;
  }
  if (!fm || !hasTargets(fm.weekly)) return null;
  const today = toYmd(opts.now ?? new Date());
  const thisWeek = mondayOf(today);
  const from = [fm.startedOn, addDays(thisWeek, -7 * LOOKBACK_WEEKS)].filter((d): d is string => Boolean(d)).sort()[0];
  const [{ data: counts, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    db.rpc("post_counts_by_day", { p_project_id: projectId, p_from: from, p_to: addDays(thisWeek, 6) }),
    db.from("pace_weeks").select("week_start, targets, published, achieved").eq("project_id", projectId).gte("week_start", from),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const byWeek = countsByWeek(counts ?? []);
  const saved = new Map((rows ?? []).map((r) => [r.week_start, r]));

  // 終わった週: 毎日のジョブが書いた結果（その週の目標で）を使い、なければ今の目標で数える
  const startWeek = fm.startedOn ? mondayOf(fm.startedOn) : null;
  const pastWeek = (w: string): CycleWeek => {
    const r = saved.get(w);
    const targets = r ? parseTargets(r.targets) : fm!.weekly;
    const published = r ? (parseTargets(r.published) as Partial<Record<SnsKey, number>>) : publishedOnly(byWeek.get(w));
    return { weekStart: w, targets, published, achieved: r ? r.achieved : achievedWith(targets, published), current: false };
  };
  const past: CycleWeek[] = [];
  for (let w = addDays(thisWeek, -7); w >= from && (!startWeek || w >= startWeek); w = addDays(w, -7)) past.push(pastWeek(w));

  const week = computeWeekPace({ targets: fm.weekly, counts: byWeek.get(thisWeek) ?? {}, today, weekStart: thisWeek, behindWeekday: opts.behindWeekday ?? DEFAULT_BEHIND_WEEKDAY });
  const streak = streakWeeks(past, thisWeek, week.achieved);

  let cycle: CoachView["cycle"] = null;
  if (fm.startedOn) {
    const info = cycleInfo(fm.startedOn, today);
    const weeks: CycleWeek[] = [];
    for (let i = 0; i < CYCLE_WEEKS; i++) {
      const w = addDays(mondayOf(fm.startedOn), i * 7);
      if (w > thisWeek) break;
      weeks.push(w === thisWeek ? { weekStart: w, targets: fm.weekly, published: publishedOnly(byWeek.get(w)), achieved: week.achieved, current: true } : (past.find((p) => p.weekStart === w) ?? pastWeek(w)));
    }
    cycle = { ...info, weeks };
  }
  return { today, thisWeek, targets: fm.weekly, week, streak, cycle };
}
