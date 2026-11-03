import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfNearBudgetSafely } from "@/lib/notify/budget";
import type { Database } from "@/lib/supabase/database.types";
import { estimateCostUsd, type TokenUsage } from "./pricing";

// 文章の AI（Claude）の上限（docs/architecture.md の 4.9。セキュリティ確認 2026-11-03 の M2・M1）。
// 呼ぶ前に DB の関数 reserve_ai_usage で見込みの費用を予約し（1 本のロックの中で本人と全体の合計を確かめる。上限は関数の中で固定）、
// 返事のあとで実際の額に直す。呼び出しに失敗したら予約を消す。Claude を呼ぶところは、すべてこの入口（withAiBudget・reserveAi）を通す
// （ai_usage に直接書くのはここだけ。tests/ai-budget.test.ts で確かめる）

type Db = SupabaseClient<Database>;

// 予約する見込みの費用（1 回の呼び出し）。表にないモデルの料金（入力 $5・出力 $25 / 100 万トークン）で、入力 8,000・出力 2,400 トークンほど。
// 返事のあとで実際の額に直すので、多めでよい（上限の近くでは、残りがこの額より少なければ断る）
export const AI_RESERVE_USD = 0.1;
// 全体の月の上限（reserve_ai_usage の c_global_monthly_usd と同じ値。運営者に 80% で知らせるのに使う）
export const AI_GLOBAL_MONTHLY_USD = 10;

export type ModelLike = { model: string; usage: TokenUsage };
export type BudgetDenied = { ok: false; message: string };

type ReserveStatus = "ok" | "global_limit" | "new_global_limit" | "user_limit" | "new_user_limit" | "daily_limit";

// 「11/10」（日本時間の月/日）
function monthDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 上限に届いたときの文言。新しい人（登録して 7 日まで）は、いつ普段の枠に戻るかを書く（AI の画像と同じ形）
export function limitMessage(status: Exclude<ReserveStatus, "ok">, newUntil: string | null): string {
  const manual = "AI を使わずに、手で書いたり入力したりはできます。";
  switch (status) {
    case "global_limit":
      return `今月の AI の利用が、yabumi 全体の上限に達しました。来月 1 日にまた使えます。${manual}`;
    case "new_global_limit":
      return `登録して 7 日までの方が使える今月の AI の枠が、いっぱいになりました。${newUntil ? `${monthDay(newUntil)} から使えます。` : ""}${manual}`;
    case "new_user_limit":
      return `登録して 7 日までは、AI の利用は少なめです（今月の分に届きました）。${newUntil ? `${monthDay(newUntil)} から普段の枠になります。` : ""}${manual}`;
    case "user_limit":
      return `今月の AI の利用が上限に達しました。来月 1 日にまた使えます。${manual}`;
    case "daily_limit":
      return "今日の AI とのやりとりが上限に達しました。明日また続きができます。";
  }
}

export type AiReservation = {
  ok: true;
  id: string;
  // 返事のあと: 実際の額に直す（threadId はあとで決まる会話のとき）
  settle: (r: ModelLike, extra?: { threadId?: string | null }) => Promise<void>;
  // 呼び出しに失敗したとき: 予約を消す（数えない）
  cancel: () => Promise<void>;
};

// 結合テストだけが使う（共有のローカル DB で、ほかのテストの利用量に左右されないように、全体の合計を本人の分だけで数える。
// asOf は登録からの日数を数える時点）。テストの実行（NODE_ENV = test）のときしか効かない。src からは呼ばない（tests/ai-budget.test.ts で確かめる）
let testScope: { scopeSelf: boolean; asOf?: Date } | null = null;
export function setAiBudgetTestScope(scope: { scopeSelf: boolean; asOf?: Date } | null) {
  testScope = scope;
}
function testArgs(userId: string): { p_scope_owner?: string; p_as_of?: string } {
  if (!testScope || process.env.NODE_ENV !== "test") return {};
  return { ...(testScope.scopeSelf ? { p_scope_owner: userId } : {}), ...(testScope.asOf ? { p_as_of: testScope.asOf.toISOString() } : {}) };
}

// 予約だけする（返事のあとに会話を作るなど、直すときに情報を足すとき）。ふつうは withAiBudget を使う
export async function reserveAi(admin: Db, opts: { userId: string; purpose: string; threadId?: string | null; now?: Date }): Promise<AiReservation | BudgetDenied> {
  const { data, error } = await admin.rpc("reserve_ai_usage", {
    p_owner_id: opts.userId,
    p_purpose: opts.purpose,
    p_cost_usd: AI_RESERVE_USD,
    p_thread_id: opts.threadId ?? undefined,
    ...testArgs(opts.userId),
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("reserve_ai_usage returned no row");
  // yabumi 全体の上限の 80% に達したら、運営者に知らせる（月に 1 回。知らせに失敗しても AI は止めない）
  await alertIfNearBudgetSafely(admin, "ai", Number(row.global_month_usd ?? 0), AI_GLOBAL_MONTHLY_USD, { now: opts.now ?? new Date() });
  if (row.status !== "ok" || !row.usage_id) return { ok: false, message: limitMessage(row.status as Exclude<ReserveStatus, "ok">, row.new_until) };
  const id = row.usage_id;
  return {
    ok: true,
    id,
    settle: async (r, extra) => {
      const { error: e } = await admin
        .from("ai_usage")
        .update({
          model: r.model,
          input_tokens: r.usage.inputTokens,
          cache_write_tokens: r.usage.cacheWriteTokens,
          cache_read_tokens: r.usage.cacheReadTokens,
          output_tokens: r.usage.outputTokens,
          cost_usd: estimateCostUsd(r.model, r.usage),
          status: "done",
          ...(extra && "threadId" in extra ? { thread_id: extra.threadId ?? null } : {}),
        })
        .eq("id", id);
      if (e) console.error("[ai-budget] 利用量を直せませんでした", e.message);
    },
    cancel: async () => {
      const { error: e } = await admin.from("ai_usage").delete().eq("id", id).eq("status", "reserved");
      if (e) console.error("[ai-budget] 予約を消せませんでした", e.message);
    },
  };
}

// 1 回の Claude の呼び出しを、予約 → 呼ぶ → 実際の額に直す（失敗したら予約を消して、エラーはそのまま投げる）で包む
export async function withAiBudget<T extends ModelLike>(
  admin: Db,
  opts: { userId: string; purpose: string; threadId?: string | null; now?: Date },
  call: () => Promise<T>,
): Promise<{ ok: true; result: T; usageId: string } | BudgetDenied> {
  const r = await reserveAi(admin, opts);
  if (!r.ok) return r;
  let result: T;
  try {
    result = await call();
  } catch (e) {
    await r.cancel();
    throw e;
  }
  await r.settle(result);
  return { ok: true, result, usageId: r.id };
}

// 上限で断られた（budgeted の呼び出しで投げる）
export class AiBudgetDenied extends Error {}

// 呼び出しの関数を、1 回ごとに予約して呼ぶものに包む（縮める呼び出しなど、失敗しても続ける 2 回目の呼び出しに使う。断られたら AiBudgetDenied を投げる）
// usageIds を渡すと、記録の id を足していく（会話をあとで作るときに linkAiUsage で結びつける）
export function budgeted<Req, T extends ModelLike>(
  admin: Db,
  opts: { userId: string; purpose: string; threadId?: string | null },
  call: (req: Req) => Promise<T>,
  usageIds?: string[],
): (req: Req) => Promise<T> {
  return async (req) => {
    const r = await withAiBudget(admin, opts, () => call(req));
    if (!r.ok) throw new AiBudgetDenied(r.message);
    usageIds?.push(r.usageId);
    return r.result;
  };
}

// あとで作った会話に、記録を結びつける
export async function linkAiUsage(admin: Db, usageIds: string[], threadId: string) {
  if (usageIds.length === 0) return;
  const { error } = await admin.from("ai_usage").update({ thread_id: threadId }).in("id", usageIds);
  if (error) console.error("[ai-budget] 記録を会話に結びつけられませんでした", error.message);
}
