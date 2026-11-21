import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadRoadmapWith, type RoadmapView } from "./load";

export { carriedTodos, itemState, scopeToGoal, thisWeekTodos, weekTodoCounts, type RoadmapItem, type RoadmapView } from "./load";

// 画面で使う（ログイン中の利用者の権限で読む）
export async function loadRoadmap(projectId: string): Promise<RoadmapView> {
  return loadRoadmapWith(await createClient(), projectId);
}
