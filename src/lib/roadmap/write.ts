import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { syncWeeklyFromRoadmap } from "@/lib/plan/save";
import { toYmd } from "@/lib/time";
import { MAX_ITEMS_PER_PROJECT, type ItemInput, type Kgi, type KpiTarget } from "./schema";

// ロードマップの書き込み（docs/architecture.md の 4.23）。手で直すときも、AI の提案を採用するときも、利用者の権限のクライアントで書く（RLS で本人のものだけ）
type Db = SupabaseClient<Database>;

export class RoadmapError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "RoadmapError";
  }
}

// 目標（KGI）と KPI の週の目標を置き換える。初めて作るときは、今日から数え始める
export async function saveGoal(db: Db, projectId: string, goal: { kgi: Kgi | null; kpiTargets: KpiTarget[] }, source: "ai" | "manual", now = new Date()): Promise<void> {
  const { data: existing } = await db.from("roadmaps").select("project_id").eq("project_id", projectId).maybeSingle();
  const row = { kgi: goal.kgi as never, kpi_targets: goal.kpiTargets as never, source };
  const { error } = existing
    ? await db.from("roadmaps").update(row).eq("project_id", projectId)
    : await db.from("roadmaps").insert({ project_id: projectId, ...row, started_on: toYmd(now) });
  if (error) throw new RoadmapError("目標を保存できませんでした。時間をおいてもう一度お試しください。");
  // SNS ごとの投稿した回数の目標は、最初の 1 か月の週の回数（伴走が見張る数字）にも写す（4.27）
  await syncWeeklyFromRoadmap(db, projectId, goal.kpiTargets, source, now);
}

// やることを足す（すでにあるものは残す）。その週の最後に並べる
export async function addItems(db: Db, projectId: string, items: ItemInput[], source: "ai" | "manual"): Promise<number> {
  if (items.length === 0) return 0;
  const { count } = await db.from("roadmap_items").select("id", { count: "exact", head: true }).eq("project_id", projectId);
  if ((count ?? 0) + items.length > MAX_ITEMS_PER_PROJECT) {
    throw new RoadmapError(`やることは 1 つのプロジェクトに ${MAX_ITEMS_PER_PROJECT} 個までです。済んだものや古いものを消してから足してください。`);
  }
  const { data: last } = await db.from("roadmap_items").select("position").eq("project_id", projectId).order("position", { ascending: false }).limit(1).maybeSingle();
  const base = (last?.position ?? 0) + 1;
  // ロードマップの行がなければ作る（目標はまだ空。数え始めの日を決めるため）
  await ensureRoadmap(db, projectId, source);
  const { error } = await db.from("roadmap_items").insert(
    items.map((i, n) => ({
      project_id: projectId,
      title: i.title,
      detail: i.detail,
      week_start: i.week_start,
      kpi: i.kpi,
      target: i.target,
      sns: i.kpi === "posts" ? i.sns : null,
      position: base + n,
      source,
    })),
  );
  if (error) throw new RoadmapError("やることを保存できませんでした。時間をおいてもう一度お試しください。");
  return items.length;
}

async function ensureRoadmap(db: Db, projectId: string, source: "ai" | "manual") {
  const { data } = await db.from("roadmaps").select("project_id").eq("project_id", projectId).maybeSingle();
  if (!data) await db.from("roadmaps").insert({ project_id: projectId, source });
}
