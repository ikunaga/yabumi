import { createClient } from "@/lib/supabase/server";
import type { AiBudgetState } from "./budget-status-text";

// 本人の AI の枠の状態（DB の ai_budget_status。数え方は予約と同じ）。読めないときは null（帯を出さず、送ったときに今までどおり断る）
export async function getAiBudgetState(purpose = "consult"): Promise<AiBudgetState | null> {
  const db = await createClient();
  const { data, error } = await db.rpc("ai_budget_status", { p_purpose: purpose });
  const row = data?.[0];
  if (error || !row) return null;
  return { status: row.status, availableFrom: row.available_from, low: row.low };
}
