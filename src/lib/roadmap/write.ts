import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GoalError, startGoal } from "@/lib/goals/write";
import { inferTodoKind } from "./todo-kind";
import { MAX_ITEMS_PER_PROJECT, type ItemInput } from "./schema";

// ロードマップの書き込み（docs/architecture.md の 4.23）。手で直すときも、AI の提案を採用するときも、利用者の権限のクライアントで書く（RLS で本人のものだけ）
type Db = SupabaseClient<Database>;

export class RoadmapError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "RoadmapError";
  }
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
  // いまの目標につなぐ（目標がなければ、KGI まだの目標を作る。DB のトリガーも同じ目標を確かめる）
  const { data: active } = await db.from("goals").select("id").eq("project_id", projectId).eq("status", "active").maybeSingle();
  let goalId = active?.id ?? null;
  if (!goalId) {
    try {
      goalId = await startGoal(db, projectId, { goal: null }, source);
    } catch (e) {
      if (e instanceof GoalError) throw new RoadmapError(e.userMessage);
      throw e;
    }
  }
  const { error } = await db.from("roadmap_items").insert(
    items.map((i, n) => ({
      project_id: projectId,
      title: i.title,
      detail: i.detail,
      week_start: i.week_start,
      kpi: i.kpi,
      target: i.target,
      sns: i.kpi === "posts" ? i.sns : null,
      // 種類がなければ（手で足した・AI が出さなかった）、数字と題名・説明から推して残す（4.42）
      kind: i.kind ?? inferTodoKind(i),
      position: base + n,
      source,
      goal_id: goalId,
    })),
  );
  if (error) throw new RoadmapError("やることを保存できませんでした。時間をおいてもう一度お試しください。");
  return items.length;
}
