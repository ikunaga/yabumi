import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// AI の費用の上限（docs/architecture.md の 4.9）。ai_usage を数えて判定する。
// 月額 3,000 円の予算に収めるため、利用者ごとと全体の両方に上限を置く。値は環境変数で変えられる
export type AiLimits = { userMonthlyUsd: number; globalMonthlyUsd: number; userDailyTurns: number };

function num(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function aiLimitsFromEnv(env: Record<string, string | undefined> = process.env): AiLimits {
  return {
    userMonthlyUsd: num(env.AI_USER_MONTHLY_BUDGET_USD, 3),
    globalMonthlyUsd: num(env.AI_GLOBAL_MONTHLY_BUDGET_USD, 10),
    userDailyTurns: num(env.AI_USER_DAILY_TURNS, 60),
  };
}

// 日本時間の月初と日付の変わり目（UTC で返す）
export function jstPeriodStarts(now: Date): { monthStart: Date; dayStart: Date } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  return { monthStart: new Date(Date.UTC(y, m, 1) - 9 * 3600_000), dayStart: new Date(Date.UTC(y, m, d) - 9 * 3600_000) };
}

export type LimitCheck = { ok: true } | { ok: false; message: string };

export async function checkAiLimits(admin: SupabaseClient<Database>, userId: string, limits: AiLimits, now = new Date()): Promise<LimitCheck> {
  const { monthStart, dayStart } = jstPeriodStarts(now);
  const { data: monthRows, error } = await admin.from("ai_usage").select("owner_id, cost_usd, created_at").gte("created_at", monthStart.toISOString());
  if (error) throw error;

  let userMonth = 0;
  let globalMonth = 0;
  let userToday = 0;
  for (const r of monthRows) {
    const cost = Number(r.cost_usd);
    globalMonth += cost;
    if (r.owner_id === userId) {
      userMonth += cost;
      if (new Date(r.created_at) >= dayStart) userToday += 1;
    }
  }
  if (globalMonth >= limits.globalMonthlyUsd) {
    return { ok: false, message: "今月の AI の利用が、矢書全体の上限に達しました。来月 1 日にまた使えます。設計の画面で手で入力することはできます。" };
  }
  if (userMonth >= limits.userMonthlyUsd) {
    return { ok: false, message: "今月の AI の利用が上限に達しました。来月 1 日にまた使えます。設計の画面で手で入力することはできます。" };
  }
  if (userToday >= limits.userDailyTurns) {
    return { ok: false, message: "今日の AI とのやりとりが上限に達しました。明日また続きができます。" };
  }
  return { ok: true };
}
