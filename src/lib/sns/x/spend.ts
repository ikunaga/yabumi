import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { xMonthlyBudgetUsd, xPostUserMonthlyUsd } from "./config";
import { X_PRICE_USD } from "./pricing";

// mineUsd: ログイン中の利用者が今月 X に使った額（数字の読み取りも含む）
// minePostUsd: そのうち、利用者ごとの上限（userBudgetUsd）に数える投稿まわりの額。userReached: その上限に達したか
// budgetReached: 矢書全体の月の上限に達したか。上限は X の開発者アカウント（オーナー）にかかるので全員分を合計するが、
// ほかの人の使った額が見えないよう、画面には達したかどうかだけを渡す
export type XSpend = { mineUsd: number; minePostUsd: number; userBudgetUsd: number; userReached: boolean; budgetUsd: number; budgetReached: boolean };

// どちらの合計も DB で出す（行を読んで足すと、API が 1 回に返す 1,000 行を超えたときに数え漏れる）
export async function xSpendThisMonth(): Promise<XSpend> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const admin = createAdminClient();
  const [mine, minePost, total] = await Promise.all([
    userId ? admin.rpc("sns_spend_this_month", { p_sns: "x", p_owner_id: userId }) : Promise.resolve({ data: 0, error: null }),
    userId ? admin.rpc("x_post_spend_this_month", { p_owner_id: userId }) : Promise.resolve({ data: 0, error: null }),
    admin.rpc("sns_spend_this_month", { p_sns: "x" }),
  ]);
  if (mine.error) throw mine.error;
  if (minePost.error) throw minePost.error;
  if (total.error) throw total.error;
  const budgetUsd = xMonthlyBudgetUsd();
  const userBudgetUsd = xPostUserMonthlyUsd();
  const minePostUsd = Number(minePost.data ?? 0);
  // 1 本分（URL なし）も送れないなら、達したとみなす
  return {
    mineUsd: Number(mine.data ?? 0),
    minePostUsd,
    userBudgetUsd,
    userReached: minePostUsd + X_PRICE_USD.post > userBudgetUsd,
    budgetUsd,
    budgetReached: Number(total.data ?? 0) + X_PRICE_USD.post > budgetUsd,
  };
}
