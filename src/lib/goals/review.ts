import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { GoalsView } from "./load";
import { goalNeedsReview, type Goal } from "./schema";
import { goalReviewOf } from "./view";

// 概要の帯の「目標を振り返る」（goal_review。段階 ② が帯、③ が AI の会話）。期限が来た・目標に届いたときに出す。
// 届いたあと、その目標の振り返りの会話を一度終えていれば（「期限まで続ける」など）、期限が来るまで出さない。
// 会話の最初の発言（ai_messages の content）に {kind: "start", topic: "goal_review", goalId} が残る（③ の決まり）
type Db = SupabaseClient<Database>;

export type GoalReview = { kind: "reached" | "ended"; goal: Goal };

export async function loadGoalReview(db: Db, goals: GoalsView): Promise<GoalReview | null> {
  const active = goals.active;
  if (!active) return null;
  const need = goalNeedsReview(active.goal, active.progress, goals.today);
  if (!need) return null;
  let kept = false;
  if (need === "reached") {
    const { data, error } = await db
      .from("ai_messages")
      .select("id, ai_threads!inner(closed_at, purpose)")
      .eq("role", "user")
      .eq("content->>kind", "start")
      .eq("content->>topic", "goal_review")
      .eq("content->>goalId", active.goal.id)
      .eq("ai_threads.purpose", "consult")
      .not("ai_threads.closed_at", "is", null)
      .limit(1);
    if (error) throw error;
    kept = (data ?? []).length > 0;
  }
  const kind = goalReviewOf(need, kept);
  return kind ? { kind, goal: active.goal } : null;
}
