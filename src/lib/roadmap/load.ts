import type { SupabaseClient } from "@supabase/supabase-js";
import { isKpiKey, type KpiKey } from "@/lib/metrics/kpis";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";
import { kgiProgress, kgiSchema, kpiTargetsSchema, weekStartOf, type DailyTotal, type ItemPostCounts, type Kgi, type KgiProgress, type KpiTarget } from "./schema";

// ロードマップの読み込み（docs/architecture.md の 4.23）。RLS で本人のものだけ。数字の合計は DB の関数で出す（行を読んで足さない）。
// クライアントは呼ぶ側が渡す（画面は queries.ts、AI と相談は利用者の権限のクライアント）

type Db = SupabaseClient<Database>;

export type RoadmapItem = {
  id: string;
  title: string;
  detail: string;
  weekStart: string;
  // 予定日（任意。その週の中の日）
  plannedOn: string | null;
  kpi: KpiKey | null;
  target: number | null;
  // 数える SNS（投稿した回数のときだけ。null はすべての SNS）
  sns: SnsKey | null;
  status: "todo" | "done" | "skipped";
  source: "ai" | "manual";
  // 数える投稿（DB の roadmap_item_progress）。読み込んでいなければ null
  posts: ItemPostCounts | null;
};

export type Roadmap = {
  kgi: Kgi | null;
  kpiTargets: KpiTarget[];
  startedOn: string;
  source: "ai" | "manual";
};

export type RoadmapView = {
  today: string;
  thisWeek: string;
  roadmap: Roadmap | null;
  items: RoadmapItem[];
  daily: DailyTotal[];
  kgi: KgiProgress | null;
};

function toRoadmap(row: { kgi: unknown; kpi_targets: unknown; started_on: string; source: string }): Roadmap {
  const kgi = kgiSchema.safeParse(row.kgi);
  const targets = kpiTargetsSchema.safeParse(row.kpi_targets);
  return {
    kgi: kgi.success ? kgi.data : null,
    kpiTargets: targets.success ? targets.data : [],
    startedOn: row.started_on,
    source: row.source === "ai" ? "ai" : "manual",
  };
}

export type ItemRow = { id: string; title: string; detail: string; week_start: string; planned_on: string | null; kpi: string | null; target: number | null; sns: string | null; status: string; source: string };
export const ITEM_COLUMNS = "id, title, detail, week_start, planned_on, kpi, target, sns, status, source";

export function toItem(r: ItemRow, posts: ItemPostCounts | null = null): RoadmapItem {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    weekStart: r.week_start,
    plannedOn: r.planned_on,
    kpi: isKpiKey(r.kpi) ? r.kpi : null,
    target: r.target === null ? null : Number(r.target),
    sns: isSnsKey(r.sns) ? r.sns : null,
    status: r.status === "done" || r.status === "skipped" ? r.status : "todo",
    source: r.source === "ai" ? "ai" : "manual",
    posts,
  };
}

// やることの進み具合を DB で数える（週が p_from〜p_to のやること）。行を読んで足さない
export async function loadItemPostCounts(db: Db, projectId: string, from: string, to: string): Promise<Map<string, ItemPostCounts>> {
  const { data, error } = await db.rpc("roadmap_item_progress", { p_project_id: projectId, p_from: from, p_to: to });
  if (error) throw error;
  return new Map(
    (data ?? []).map((r) => [
      r.item_id,
      { published: Number(r.published), scheduled: Number(r.scheduled), linkedPublished: Number(r.linked_published), linkedScheduled: Number(r.linked_scheduled) },
    ]),
  );
}

// 予定日を過ぎたのに、まだ投稿をつくっていない（結びついた投稿がない）済んでいないやること（伴走の声かけに使う）
export function overdueItems(items: RoadmapItem[], today: string): RoadmapItem[] {
  return items.filter((i) => i.status === "todo" && i.plannedOn !== null && i.plannedOn < today && (i.posts?.linkedPublished ?? 0) + (i.posts?.linkedScheduled ?? 0) === 0);
}

export async function loadRoadmapWith(supabase: Db, projectId: string, now = new Date()): Promise<RoadmapView> {
  const today = toYmd(now);
  const thisWeek = weekStartOf(today);
  const [{ data: row, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    supabase.from("roadmaps").select("kgi, kpi_targets, started_on, source").eq("project_id", projectId).maybeSingle(),
    supabase
      .from("roadmap_items")
      .select(ITEM_COLUMNS)
      .eq("project_id", projectId)
      .order("week_start")
      .order("position")
      .order("created_at")
      .limit(500),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const roadmap = row ? toRoadmap(row) : null;
  const weeks = (rows ?? []).map((r) => r.week_start);
  const counts = weeks.length ? await loadItemPostCounts(supabase, projectId, weeks[0], weeks[weeks.length - 1]) : new Map<string, ItemPostCounts>();
  const items = (rows ?? []).map((r) => toItem(r, counts.get(r.id) ?? { published: 0, scheduled: 0, linkedPublished: 0, linkedScheduled: 0 }));

  // 数字は、数え始めの日（なければ 8 週前）から来週の終わりまで（やることの週の数字と、KGI の合計に使う）
  const from = [roadmap?.startedOn, items[0]?.weekStart, addDays(thisWeek, -56)].filter(Boolean).sort()[0] as string;
  const to = addDays(thisWeek, 13);
  const [{ data: totals, error: e3 }, { data: bySns, error: e4 }] = await Promise.all([
    supabase.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: from, p_to: to }),
    supabase.rpc("post_counts_by_day", { p_project_id: projectId, p_from: from, p_to: to }),
  ]);
  if (e3) throw e3;
  if (e4) throw e4;
  const snsByDay = new Map<string, Partial<Record<SnsKey, number>>>();
  for (const r of bySns ?? []) {
    if (!isSnsKey(r.sns) || !Number(r.published)) continue;
    const m = snsByDay.get(r.day) ?? {};
    m[r.sns] = (m[r.sns] ?? 0) + Number(r.published);
    snsByDay.set(r.day, m);
  }
  const daily: DailyTotal[] = (totals ?? []).map((d) => ({ day: d.day, posts: Number(d.posts), link_clicks: Number(d.link_clicks), postsBySns: snsByDay.get(d.day) ?? {} }));

  return {
    today,
    thisWeek,
    roadmap,
    items,
    daily,
    kgi: roadmap?.kgi ? kgiProgress(roadmap.kgi, roadmap.startedOn, today, daily) : null,
  };
}

// 概要の「今週のやること」: 今週の済んでいないもの（3 件まで）
export function thisWeekTodos(view: RoadmapView, limit = 3): RoadmapItem[] {
  return view.items.filter((i) => i.weekStart === view.thisWeek && i.status === "todo").slice(0, limit);
}
