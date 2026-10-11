import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { xMonthlyBudgetUsd } from "./config";

// mineUsd: ログイン中の利用者が今月 X に使った額（RLS で本人の記録だけを足す）
// budgetReached: 矢書全体の月の上限に達したか。上限は X の開発者アカウント（オーナー）にかかるので全員分を合計するが、
// ほかの人の使った額が見えないよう、画面には達したかどうかだけを渡す
export type XSpend = { mineUsd: number; budgetUsd: number; budgetReached: boolean };

function monthStartJst(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000).toISOString();
}

export async function xSpendThisMonth(): Promise<XSpend> {
  const supabase = await createClient();
  const [{ data: rows, error }, { data: total, error: totalError }] = await Promise.all([
    supabase.from("sns_api_usage").select("cost_usd").eq("sns", "x").gte("created_at", monthStartJst()),
    createAdminClient().rpc("sns_spend_this_month", { p_sns: "x" }),
  ]);
  if (error) throw error;
  if (totalError) throw totalError;
  const budgetUsd = xMonthlyBudgetUsd();
  const mineUsd = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  // 1 本分（URL なし）も送れないなら、達したとみなす
  return { mineUsd, budgetUsd, budgetReached: Number(total ?? 0) + 0.015 > budgetUsd };
}
