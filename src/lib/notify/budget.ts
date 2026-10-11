import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { notifyOperatorOnce, type OperatorNotifyDeps, type OperatorNotifyResult } from "./operator";

// 矢書全体の月の上限（X・AI）の 80% に達したら、運営者にメールで知らせる（docs/cost-review.md の「見つけた穴」）。
// 上限に達すると全員がその月は使えなくなるので、その前に、上限を上げるか、使い方のおかしい人がいないかを確かめられるように。
// 同じ月の同じ上限は 1 回だけ（key に月を入れる）。本文に利用者の情報は入れない
export const BUDGET_ALERT_RATIO = 0.8;

export type BudgetKind = "x" | "ai";

const LABEL: Record<BudgetKind, { name: string; env: string; where: string }> = {
  x: {
    name: "X の API",
    env: "X_MONTHLY_BUDGET_USD",
    where: "select owner_id, sum(cost_usd) from sns_api_usage where sns = 'x' and created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo' group by 1 order by 2 desc limit 10;",
  },
  ai: {
    name: "AI（Claude API）",
    env: "AI_GLOBAL_MONTHLY_BUDGET_USD",
    where: "select owner_id, sum(cost_usd) from ai_usage where created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo' group by 1 order by 2 desc limit 10;",
  },
};

// 日本時間の年月（"2026-10"）
function jstMonth(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

export function budgetAlertKey(kind: BudgetKind, now: Date, scope?: string | null): string {
  return `budget_80:${kind}:${jstMonth(now)}${scope ? `:${scope}` : ""}`;
}

export function budgetAlertMail(kind: BudgetKind, spentUsd: number, budgetUsd: number) {
  const l = LABEL[kind];
  const full = spentUsd >= budgetUsd;
  return {
    subject: full ? `${l.name} の今月の費用が、矢書全体の上限に達しました` : `${l.name} の今月の費用が、矢書全体の上限の ${Math.round(BUDGET_ALERT_RATIO * 100)}% に達しました`,
    text: [
      "矢書の運営者へのお知らせです（自動で送っています）。",
      "",
      `${l.name} の今月の費用（日本時間の月初から）: $${spentUsd.toFixed(2)}`,
      `矢書全体の月の上限（${l.env}）: $${budgetUsd.toFixed(2)}`,
      full
        ? "上限に達したので、今月の残りは全員が自動では使えません（X は手で投稿して記録、AI は手で入力）。"
        : "上限に達すると、今月の残りは全員が自動では使えなくなります。",
      "",
      "確かめること:",
      "1. Supabase の SQL Editor で、費用の多い利用者がいないかを見る:",
      `   ${l.where}`,
      "2. 1 人に偏っているなら、利用者ごとの上限を下げるか、悪用として止める",
      `3. 普通に使う人が増えたのなら、${l.env} を上げる（月の予算と、docs/cost-review.md を確かめてから）`,
      "",
      "同じお知らせは、同じ月に 1 回だけ送ります。",
    ].join("\n"),
  };
}

// spentUsd が上限の 80% 以上なら知らせる。知らせたかどうか（"skipped" は今月もう知らせた、null はまだ 80% に達していない）
export async function alertIfNearBudget(
  admin: SupabaseClient<Database>,
  kind: BudgetKind,
  spentUsd: number,
  budgetUsd: number,
  // scope: 上限を数える範囲を利用者に絞ったとき（テスト）、その ID。知らせた記録の key を分け、本番の知らせとぶつからないようにする
  deps: { now?: Date; notify?: OperatorNotifyDeps; scope?: string | null } = {},
): Promise<OperatorNotifyResult | "skipped" | null> {
  if (!(budgetUsd > 0) || spentUsd < budgetUsd * BUDGET_ALERT_RATIO) return null;
  return notifyOperatorOnce(admin, budgetAlertKey(kind, deps.now ?? new Date(), deps.scope), 40, budgetAlertMail(kind, spentUsd, budgetUsd), deps.notify);
}

// 知らせるのに失敗しても、本来の処理（送信・AI の呼び出し）は止めない
export async function alertIfNearBudgetSafely(...args: Parameters<typeof alertIfNearBudget>): Promise<void> {
  await alertIfNearBudget(...args).catch((e) => console.error("[budget] 運営者への知らせに失敗しました", e instanceof Error ? e.message : e));
}
