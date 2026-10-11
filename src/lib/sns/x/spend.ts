import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { xMonthlyBudgetUsd } from "./config";

// mineUsd: ログイン中の利用者が今月 X に使った額
// budgetReached: 矢書全体の月の上限に達したか。上限は X の開発者アカウント（オーナー）にかかるので全員分を合計するが、
// ほかの人の使った額が見えないよう、画面には達したかどうかだけを渡す
export type XSpend = { mineUsd: number; budgetUsd: number; budgetReached: boolean };

// どちらの合計も DB で出す（行を読んで足すと、API が 1 回に返す 1,000 行を超えたときに数え漏れる）
export async function xSpendThisMonth(): Promise<XSpend> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const admin = createAdminClient();
  const [mine, total] = await Promise.all([
    userId ? admin.rpc("sns_spend_this_month", { p_sns: "x", p_owner_id: userId }) : Promise.resolve({ data: 0, error: null }),
    admin.rpc("sns_spend_this_month", { p_sns: "x" }),
  ]);
  if (mine.error) throw mine.error;
  if (total.error) throw total.error;
  const budgetUsd = xMonthlyBudgetUsd();
  // 1 本分（URL なし）も送れないなら、達したとみなす
  return { mineUsd: Number(mine.data ?? 0), budgetUsd, budgetReached: Number(total.data ?? 0) + 0.015 > budgetUsd };
}
