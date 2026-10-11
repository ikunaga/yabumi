import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { xMonthlyBudgetUsd } from "./config";

export type XSpend = { spentUsd: number; budgetUsd: number };

// 今月（日本時間）に矢書全体で X に払った額と、月の上限。上限は X の開発者アカウント（オーナー）にかかるので全員分を合計する
export async function xSpendThisMonth(): Promise<XSpend> {
  const { data, error } = await createAdminClient().rpc("sns_spend_this_month", { p_sns: "x" });
  if (error) throw error;
  return { spentUsd: Number(data ?? 0), budgetUsd: xMonthlyBudgetUsd() };
}
