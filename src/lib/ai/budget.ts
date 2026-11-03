import type { SupabaseClient } from "@supabase/supabase-js";
import { alertIfNearBudgetSafely } from "@/lib/notify/budget";
import type { Database } from "@/lib/supabase/database.types";
import { estimateCostUsd, maxTextPricePerMillion, type TokenUsage } from "./pricing";
import { notBilled } from "./provider-failure";

// 文章の AI（Claude）の上限（docs/architecture.md の 4.9。セキュリティ確認 2026-11-03 の M2・M1・M3）。
// 呼ぶ前に DB の関数 reserve_ai_usage で見込みの費用を予約し（1 本のロックの中で本人と全体の合計を確かめる。上限は関数の中で固定）、
// 返事のあとで実際の額に直す。見込みは、その呼び出しで起こりうる最大の額（送る中身の大きさと出力の上限から。下の reserveEstimateUsd）なので、
// 同時に送っても、実際の額に直したあとの合計は上限を超えない。呼び出しに失敗したら、請求されないことがはっきりしているとき（4xx）だけ予約を消し、
// それ以外（5xx・タイムアウト・接続が切れた・返事を読めなかった）は見込みの額のまま数える。
// Claude を呼ぶところは、すべてこの入口（withAiBudget・reserveAi・budgeted）を通す（ai_usage に直接書くのはここだけ。tests/ai-budget.test.ts で確かめる）

type Db = SupabaseClient<Database>;

// 呼び出しの種類ごとの出力の上限（max_tokens。思考を含む）。anthropic.ts はこの値で呼ぶ（見込みと実際の上限を 1 か所にそろえる）
export const AI_MAX_TOKENS = {
  plan_coach: 8000,
  consult: 8000,
  file_pick: 2000,
  app_description: 4000,
  post_ideas: 16000,
  ai_check: 4000,
  image_brief: 4000,
  photo_ideas: 4000,
  shorten: 4000,
  tidy_draft: 8000,
} as const;
export type AiCall = keyof typeof AI_MAX_TOKENS;

// 送る中身のほかに Claude の側で足される分（構造化出力の形（JSON スキーマ）・思考やメッセージの区切りの指示）。トークン数。
// tests/ai-budget.test.ts で、どの返事の形の JSON スキーマもこれより小さいことを確かめる
export const REQUEST_OVERHEAD_TOKENS = 8000;
// 1 回の呼び出しで予約できる見込みの上限（reserve_ai_usage の c_max_reservation_usd と同じ値）。超える呼び出しは送らない（会話が長くなりすぎたときなど）
export const AI_MAX_RESERVATION_USD = 1;
// 全体の月の上限（reserve_ai_usage の c_global_monthly_usd と同じ値。運営者に 80% で知らせるのに使う）
export const AI_GLOBAL_MONTHLY_USD = 10;

// 1 回の呼び出しで起こりうる最大の費用（米ドル）。
// - 入力: 送る中身（system と messages）の JSON の UTF-8 のバイト数を、トークン数の上限とみなす（Claude のトークンは 1 つが 1 バイト以上なので、
//   これより多くはならない。JSON の記号の分だけ多めになる）。足される分（REQUEST_OVERHEAD_TOKENS）を加え、いちばん高い入力の単価（キャッシュへの書き込み）で数える
// - 出力: 出力の上限（AI_MAX_TOKENS）を、いちばん高い出力の単価で数える
export function reserveEstimateUsd(call: AiCall, request: unknown): number {
  const inputTokens = Buffer.byteLength(JSON.stringify(request) ?? "", "utf8") + REQUEST_OVERHEAD_TOKENS;
  const p = maxTextPricePerMillion();
  return Math.ceil(((inputTokens * p.input + AI_MAX_TOKENS[call] * p.output) / 1_000_000) * 1_000_000) / 1_000_000;
}

// 見込みが 1 回の上限を超えたとき（会話が長くなりすぎたなど）の文言
export const TOO_LARGE_MESSAGE = "AI に送る内容が長すぎます。会話が長くなったときは、新しい会話を始めてください。";

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
  // 予約した見込みの額
  estimateUsd: number;
  // 返事のあと: 実際の額に直す（threadId はあとで決まる会話のとき）
  settle: (r: ModelLike, extra?: { threadId?: string | null }) => Promise<void>;
  // 呼び出しに失敗したとき: 請求されないことがはっきりしている失敗（4xx）なら予約を消し、それ以外は見込みの額のまま数える
  fail: (e: unknown) => Promise<void>;
  // AI を呼ばずに終わるとき: 予約を消す
  cancel: () => Promise<void>;
};

export type BudgetOpts = { userId: string; purpose: string; call: AiCall; threadId?: string | null; now?: Date };

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

// 予約だけする（返事のあとに会話を作るなど、直すときに情報を足すとき）。ふつうは withAiBudget を使う。request は送る中身（見込みの額を決める）
export async function reserveAi(admin: Db, opts: BudgetOpts & { request: unknown }): Promise<AiReservation | BudgetDenied> {
  const estimate = reserveEstimateUsd(opts.call, opts.request);
  if (estimate > AI_MAX_RESERVATION_USD) return { ok: false, message: TOO_LARGE_MESSAGE };
  const { data, error } = await admin.rpc("reserve_ai_usage", {
    p_owner_id: opts.userId,
    p_purpose: opts.purpose,
    p_cost_usd: estimate,
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
  const cancel = async () => {
    const { error: e } = await admin.from("ai_usage").delete().eq("id", id).eq("status", "reserved");
    if (e) console.error("[ai-budget] 予約を消せませんでした", e.message);
  };
  return {
    ok: true,
    id,
    estimateUsd: estimate,
    settle: async (r, extra) => {
      const cost = estimateCostUsd(r.model, r.usage);
      // 見込みは最大の額のはず。超えたら見積もりの考え方が崩れているので知らせる（記録は実際の額のまま）
      if (cost > estimate) console.error("[ai-budget] 実際の額が予約の見込みを超えました", { call: opts.call, estimate, cost });
      const { error: e } = await admin
        .from("ai_usage")
        .update({
          model: r.model,
          input_tokens: r.usage.inputTokens,
          cache_write_tokens: r.usage.cacheWriteTokens,
          cache_read_tokens: r.usage.cacheReadTokens,
          output_tokens: r.usage.outputTokens,
          cost_usd: cost,
          status: "done",
          ...(extra && "threadId" in extra ? { thread_id: extra.threadId ?? null } : {}),
        })
        .eq("id", id);
      if (e) console.error("[ai-budget] 利用量を直せませんでした", e.message);
    },
    fail: async (err) => {
      if (notBilled(err)) return cancel();
      // 請求されたかわからない: 見込みの額のまま、終わった行にする（費用は予約の額のまま）
      const { error: e } = await admin.from("ai_usage").update({ model: "failed", status: "done" }).eq("id", id).eq("status", "reserved");
      if (e) console.error("[ai-budget] 失敗した呼び出しを記録できませんでした", e.message);
    },
    cancel,
  };
}

// 1 回の Claude の呼び出しを、予約 → 呼ぶ → 実際の額に直す（失敗したら fail で扱いを決めて、エラーはそのまま投げる）で包む
export async function withAiBudget<Req, T extends ModelLike>(
  admin: Db,
  opts: BudgetOpts,
  request: Req,
  call: (req: Req) => Promise<T>,
): Promise<{ ok: true; result: T; usageId: string } | BudgetDenied> {
  const r = await reserveAi(admin, { ...opts, request });
  if (!r.ok) return r;
  let result: T;
  try {
    result = await call(request);
  } catch (e) {
    await r.fail(e);
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
  opts: BudgetOpts,
  call: (req: Req) => Promise<T>,
  usageIds?: string[],
): (req: Req) => Promise<T> {
  return async (req) => {
    const r = await withAiBudget(admin, opts, req, call);
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
