import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { xMonthlyBudgetUsd, xPostUserMonthlyUsd } from "./config";
import { inLaterJstMonth, judgeXSend, xSendCostUsd, type XOver } from "./send-rules";
import type { XSpend } from "./spend-cache";

export type XSendVerdict = { over: XOver | null; costUsd: number; userBudgetUsd: number };

// X をいま（at に）送ったら上限に当たるか。額は送信ジョブと同じ関数で数える（x_post_spend_this_month・sns_spend_this_month。月の区切りは日本時間）。
// 送る時刻がいまより後の月なら、その月はまだ何も使っていないものとして見る（月が替わると上限が戻る）。
// scopeOwner: 全体の上限をその利用者の額だけで数える（送信ジョブの budgetScopeOwner と同じ。テスト用）。
// ここは送る前の見込みで、最後は送信ジョブの reserve_sns_spend が止める（調べてから送るまでにほかの送信で額が増えても、費用は超えない）
export async function xSendVerdict(admin: SupabaseClient<Database>, ownerId: string, a: { text: string; altCount: number; at?: Date | null; now?: Date; scopeOwner?: string | null }): Promise<XSendVerdict> {
  const now = a.now ?? new Date();
  if (a.at && inLaterJstMonth(a.at, now)) return xVerdictFromSpend({ mine: 0, total: 0 }, a);
  return xVerdictFromSpend(await xSpendThisMonth(admin, ownerId, a.scopeOwner), a);
}

// 今月の X の額（その利用者の分と全体。送信ジョブと同じ関数）
export async function xSpendThisMonth(admin: SupabaseClient<Database>, ownerId: string, scopeOwner?: string | null): Promise<XSpend> {
  const [mine, total] = await Promise.all([admin.rpc("x_post_spend_this_month", { p_owner_id: ownerId }), admin.rpc("sns_spend_this_month", scopeOwner ? { p_sns: "x", p_owner_id: scopeOwner } : { p_sns: "x" })]);
  if (mine.error) throw mine.error;
  if (total.error) throw total.error;
  return { mine: Number(mine.data ?? 0), total: Number(total.data ?? 0) };
}

// 今月の額から判定する。送る時刻がいまより後の月なら、その月はまだ何も使っていないものとして見る
export function xVerdictFromSpend(spend: XSpend, a: { text: string; altCount: number; at?: Date | null; now?: Date }): XSendVerdict {
  const costUsd = xSendCostUsd(a.text, a.altCount);
  const userBudgetUsd = xPostUserMonthlyUsd();
  const budgetUsd = xMonthlyBudgetUsd();
  const later = Boolean(a.at && inLaterJstMonth(a.at, a.now ?? new Date()));
  return { over: judgeXSend({ userSpentUsd: later ? 0 : spend.mine, totalSpentUsd: later ? 0 : spend.total, costUsd, userBudgetUsd, budgetUsd }), costUsd, userBudgetUsd };
}
