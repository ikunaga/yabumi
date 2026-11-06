import "server-only";
import { aiConfigured } from "@/lib/ai/anthropic";
import { countsByWeek, parseTargets } from "@/lib/coach/load";
import { computeWeekPace, hasTargets, mondayOf, type WeeklyTargets } from "@/lib/coach/pace";
import { loadGoals } from "@/lib/goals/load";
import { weeklyTargetsOf } from "@/lib/goals/schema";
import { formatMetric, metricLabel, milestoneName, spanText } from "@/lib/goals/view";
import { ITEM_COLUMNS, loadItemPostCounts, toItem } from "@/lib/roadmap/load";
import type { DailyTotal } from "@/lib/roadmap/schema";
import { SNS } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time";
import { toCalendarTodo, type WeekBand, type WeekGoal } from "./roadmap-view";

export type { CalendarTodo, WeekBand, WeekGoal } from "./roadmap-view";

// カレンダーに出すロードマップのやることと、週の目標（F06・F10。docs/architecture.md の 4.23）。
// やることは週の帯（月の表示は各週の行の上、週の表示は 7 日の上）に、予定日のあるものはその日のマスにも出す。
// 進み具合は DB で数える（やること: roadmap_item_progress、週の目標: post_counts_by_day。伴走のペースと同じ計算）

// カレンダーで 1 度に読むやることの上限（1 プロジェクトのやることは 200 まで。6 週分なら届かない）
const MAX_TODOS = 300;

// 見出しの横に小さく出す中間の目標（その期間に重なる区切り）
export type MilestoneNote = { key: string; text: string };

// weekStarts（月曜の並び）の週の帯と、その期間の中間の目標を読む。週の目標は、いまの目標の行動の目標（goal_kpis の action）
export async function loadCalendarRoadmap(projectId: string, weekStarts: string[], today: string, productType: string | null = null): Promise<{ bands: Map<string, WeekBand>; milestones: MilestoneNote[] }> {
  const supabase = await createClient();
  const first = weekStarts[0];
  const last = weekStarts[weekStarts.length - 1];
  const lastDay = addDays(last, 6);
  const [{ data: rows, error: e1 }, counts, { data: totals, error: e2 }, { data: bySns, error: e3 }, goals, { data: saved, error: e5 }] = await Promise.all([
    supabase
      .from("roadmap_items")
      .select(ITEM_COLUMNS)
      .eq("project_id", projectId)
      .gte("week_start", first)
      .lte("week_start", last)
      .order("week_start")
      .order("position")
      .order("created_at")
      .limit(MAX_TODOS),
    loadItemPostCounts(supabase, projectId, first, last),
    supabase.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: first, p_to: lastDay }),
    supabase.rpc("post_counts_by_day", { p_project_id: projectId, p_from: first, p_to: lastDay }),
    loadGoals(supabase, projectId),
    supabase.from("pace_weeks").select("week_start, targets").eq("project_id", projectId).gte("week_start", first).lte("week_start", last),
  ]);
  for (const e of [e1, e2, e3, e5]) if (e) throw e;

  const daily: DailyTotal[] = (totals ?? []).map((d) => ({ day: d.day, posts: Number(d.posts), link_clicks: Number(d.link_clicks) }));
  const items = (rows ?? []).map((r) => toItem(r, counts.get(r.id) ?? { published: 0, scheduled: 0, linkedPublished: 0, linkedScheduled: 0 }));

  // 週の目標（いまの目標の SNS ごとの週の本数）。終わった週は、毎日のジョブが残したその週の目標を使う。目標の数え始めより前の週には出さない
  const active = goals.active;
  const targets: WeeklyTargets = weeklyTargetsOf(active?.actions ?? []);
  const startWeek = active ? mondayOf(active.goal.startsOn) : null;
  const savedTargets = new Map((saved ?? []).map((r) => [r.week_start, parseTargets(r.targets)]));
  const byWeek = countsByWeek(bySns ?? []);

  const bands = new Map<string, WeekBand>();
  for (const w of weekStarts) {
    const weekTargets = savedTargets.get(w) ?? targets;
    const goals: WeekGoal[] =
      hasTargets(weekTargets) && (!startWeek || w >= startWeek)
        ? computeWeekPace({ targets: weekTargets, counts: byWeek.get(w) ?? {}, today, weekStart: w }).rows.map((r) => ({
            sns: SNS[r.sns].label,
            published: r.published,
            scheduled: r.scheduled,
            target: r.target,
            status: r.status,
          }))
        : [];
    bands.set(w, { weekStart: w, todos: [], goals });
  }
  const ctx = { base: `/projects/${projectId}`, aiEnabled: aiConfigured() };
  for (const item of items) bands.get(item.weekStart)?.todos.push(toCalendarTodo(item, daily, today, ctx));

  // 中間の目標（KGI があるときだけ。目標の値のない区切りは出さない）
  const goal = active?.goal;
  const milestones: MilestoneNote[] =
    active && goal?.metric && goal.metric !== "posts"
      ? active.milestones
          .filter((m) => m.target !== null && m.startsOn <= lastDay && m.endsOn >= first)
          .map((m) => ({ key: m.id, text: `${milestoneName(m.seq)}の目標 ${metricLabel({ metric: goal.metric!, action: goal.action, sns: goal.sns }, productType)} ${formatMetric(goal.metric!, m.target!)}（${spanText(m.startsOn, m.endsOn)}）` }))
      : [];
  return { bands, milestones };
}
