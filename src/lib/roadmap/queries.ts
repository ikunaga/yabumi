import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isKpiKey, type KpiKey } from "@/lib/metrics/kpis";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { addDays, toYmd } from "@/lib/time";
import { kgiProgress, kgiSchema, kpiTargetsSchema, weekStartOf, type DailyTotal, type Kgi, type KgiProgress, type KpiTarget } from "./schema";

// ロードマップの読み込み（docs/architecture.md の 4.23）。RLS で本人のものだけ。数字の合計は DB の関数で出す（行を読んで足さない）

type Db = SupabaseClient<Database>;

export type RoadmapItem = {
  id: string;
  title: string;
  detail: string;
  weekStart: string;
  kpi: KpiKey | null;
  target: number | null;
  status: "todo" | "done" | "skipped";
  source: "ai" | "manual";
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

function toItem(r: { id: string; title: string; detail: string; week_start: string; kpi: string | null; target: number | null; status: string; source: string }): RoadmapItem {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    weekStart: r.week_start,
    kpi: isKpiKey(r.kpi) ? r.kpi : null,
    target: r.target === null ? null : Number(r.target),
    status: r.status === "done" || r.status === "skipped" ? r.status : "todo",
    source: r.source === "ai" ? "ai" : "manual",
  };
}

// 画面と AI の「いまの状況」で使う。db を渡すと、そのクライアントで読む（AI の処理は利用者の権限のクライアントを渡す）
export async function loadRoadmap(projectId: string, db?: Db, now = new Date()): Promise<RoadmapView> {
  const supabase = db ?? (await createClient());
  const today = toYmd(now);
  const thisWeek = weekStartOf(today);
  const [{ data: row, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    supabase.from("roadmaps").select("kgi, kpi_targets, started_on, source").eq("project_id", projectId).maybeSingle(),
    supabase
      .from("roadmap_items")
      .select("id, title, detail, week_start, kpi, target, status, source")
      .eq("project_id", projectId)
      .order("week_start")
      .order("position")
      .order("created_at")
      .limit(500),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const roadmap = row ? toRoadmap(row) : null;
  const items = (rows ?? []).map(toItem);

  // 数字は、数え始めの日（なければ 8 週前）から来週の終わりまで（やることの週の数字と、KGI の合計に使う）
  const from = [roadmap?.startedOn, items[0]?.weekStart, addDays(thisWeek, -56)].filter(Boolean).sort()[0] as string;
  const to = addDays(thisWeek, 13);
  const { data: totals, error: e3 } = await supabase.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: from, p_to: to });
  if (e3) throw e3;
  const daily: DailyTotal[] = (totals ?? []).map((d) => ({ day: d.day, posts: Number(d.posts), link_clicks: Number(d.link_clicks) }));

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
