import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfNearBudgetSafely } from "@/lib/notify/budget";
import type { OperatorNotifyDeps } from "@/lib/notify/operator";
import type { Database } from "@/lib/supabase/database.types";

// X に費用を記録したあとに呼ぶ。矢書全体の今月の X の費用が上限の 80% 以上なら、運営者に知らせる（月に 1 回）。
// scopeOwner は上限を数える範囲と同じ（テストで、共有の DB の他の記録に左右されないため）。本番は渡さない
export async function alertIfNearXBudget(
  admin: SupabaseClient<Database>,
  budgetUsd: number | null | undefined,
  deps: { scopeOwner?: string | null; now?: Date; notify?: OperatorNotifyDeps } = {},
): Promise<void> {
  if (budgetUsd == null) return;
  const { data, error } = await admin.rpc("sns_spend_this_month", { p_sns: "x", ...(deps.scopeOwner ? { p_owner_id: deps.scopeOwner } : {}) });
  if (error) {
    console.error("[budget] X の今月の費用を読めませんでした", error.message);
    return;
  }
  await alertIfNearBudgetSafely(admin, "x", Number(data ?? 0), budgetUsd, { now: deps.now, notify: deps.notify, scope: deps.scopeOwner });
}
