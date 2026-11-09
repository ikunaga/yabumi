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
  // 書き方（文調のメモ）を読み取る（docs/design/voice-from-posts.md の 4）
  voice_memo: 4000,
} as const;
export type AiCall = keyof typeof AI_MAX_TOKENS;

// 送る中身のほかに Claude の側で足される分（構造化出力の形（JSON スキーマ）・思考やメッセージの区切りの指示）。トークン数。
// tests/ai-budget.test.ts で、どの返事の形の JSON スキーマもこれより小さいことを確かめる
export const REQUEST_OVERHEAD_TOKENS = 8000;
// 1 回の呼び出しで予約できる見込みの上限（reserve_ai_usage の c_max_reservation_usd と同じ値）。超える呼び出しは送らない（会話が長くなりすぎたときなど）
export const AI_MAX_RESERVATION_USD = 1;
// 全体の月の上限（reserve_ai_usage の c_global_monthly_usd と同じ値。運営者に 80% で知らせるのに使う）
export const AI_GLOBAL_MONTHLY_USD = 10;

// count_tokens で数えたトークン数に掛けるゆとり。数えるのは呼ぶモデル（Opus 5.5）のトークン数だが、安全のための判定で別のモデルに回ったとき
// （fallbacks）は、トークンの切り方が違って数が増えうる（モデルの世代でおよそ 1.35 倍まで違う）ため
export const COUNTED_TOKENS_MARGIN = 1.35;

// 1 回の呼び出しで起こりうる最大の費用（米ドル）。
// - 入力: 送る前に count_tokens で数えたトークン数（countedInputTokens）に COUNTED_TOKENS_MARGIN を掛けたもの。
//   数えられなかったときは、送る中身（system と messages）の JSON の UTF-8 のバイト数をトークン数の上限とみなし（Claude のトークンは 1 つが 1 バイト以上なので、
//   これより多くはならない。日本語は 1 字 3 バイトなので、実際のおよそ 3 倍になる）、足される分（REQUEST_OVERHEAD_TOKENS）を加える。
//   両方わかるときは小さいほう。いちばん高い入力の単価（キャッシュへの書き込み）で数える
// - 出力: 出力の上限（AI_MAX_TOKENS）を、いちばん高い出力の単価で数える
export function reserveEstimateUsd(call: AiCall, request: unknown, countedInputTokens?: number): number {
  const byBytes = Buffer.byteLength(JSON.stringify(request) ?? "", "utf8") + REQUEST_OVERHEAD_TOKENS;
  const inputTokens = countedInputTokens === undefined ? byBytes : Math.min(byBytes, Math.ceil(countedInputTokens * COUNTED_TOKENS_MARGIN));
  const p = maxTextPricePerMillion();
  return Math.ceil(((inputTokens * p.input + AI_MAX_TOKENS[call] * p.output) / 1_000_000) * 1_000_000) / 1_000_000;
}

// 送る前に入力のトークン数を数える関数（anthropic.ts の呼び出しに countTokens として付ける。count_tokens は無料）。
// テストの偽の呼び出しには付いていないので、バイト数で見積もる
export type CountTokens<Req> = (req: Req) => Promise<number>;
export function countable<F extends (req: never) => Promise<unknown>>(call: F, countTokens: CountTokens<Parameters<F>[0]>): F & { countTokens: CountTokens<Parameters<F>[0]> } {
  return Object.assign(call, { countTokens });
}
export function tokenCounterOf<Req>(call: (req: Req) => unknown): CountTokens<Req> | undefined {
  const c = (call as { countTokens?: unknown }).countTokens;
  return typeof c === "function" ? (c as CountTokens<Req>) : undefined;
}

// 数えるのに時間がかかったら知らせる（ミリ秒）
const SLOW_COUNT_MS = 2000;

// 見込みの額を出す。数えられれば数えた値で、数えられなければ（失敗・数える関数がない）バイト数で（上限を超えない側）
export async function estimateRequestUsd<Req>(call: AiCall, request: Req, countTokens?: CountTokens<Req>): Promise<number> {
  if (countTokens) {
    const started = performance.now();
    try {
      const n = await countTokens(request);
      const ms = performance.now() - started;
      if (ms > SLOW_COUNT_MS) console.warn("[ai-budget] トークン数を数えるのに時間がかかりました", { call, ms: Math.round(ms) });
      if (Number.isFinite(n) && n > 0) return reserveEstimateUsd(call, request, n);
    } catch (e) {
      console.error("[ai-budget] トークン数を数えられませんでした（バイト数で見積もります）", e instanceof Error ? e.message : e);
    }
  }
  return reserveEstimateUsd(call, request);
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

// 予約だけする（返事のあとに会話を作るなど、直すときに情報を足すとき）。ふつうは withAiBudget を使う。request は送る中身（見込みの額を決める）。
// countTokens は呼び出しに付いている数える関数（tokenCounterOf(deps.callX)）。
// 順番（2026-11-06 のセキュリティ確認の L4）: ① 数えずにバイト数の見込み（大きめ）で予約する → ② 通ったら count_tokens で数え直し、予約の額を下げる。
// 上限に届いた人の呼び出しでは count_tokens を呼ばない。① で断られても、いちばん小さい見込みなら通るとき（上限の近く）だけ、数えてから予約し直す
export async function reserveAi<Req>(admin: Db, opts: BudgetOpts & { request: Req; countTokens?: CountTokens<Req> }): Promise<AiReservation | BudgetDenied> {
  const byBytes = reserveEstimateUsd(opts.call, opts.request);
  if (!opts.countTokens && byBytes > AI_MAX_RESERVATION_USD) return { ok: false, message: TOO_LARGE_MESSAGE };
  const reserve = async (cost: number) => {
    const { data, error } = await admin.rpc("reserve_ai_usage", {
      p_owner_id: opts.userId,
      p_purpose: opts.purpose,
      p_cost_usd: cost,
      p_thread_id: opts.threadId ?? undefined,
      ...testArgs(opts.userId),
    });
    if (error) throw error;
    const r = data?.[0];
    if (!r) throw new Error("reserve_ai_usage returned no row");
    return r;
  };
  const drop = async (usageId: string) => {
    const { error: e } = await admin.from("ai_usage").delete().eq("id", usageId).eq("status", "reserved");
    if (e) console.error("[ai-budget] 予約を消せませんでした", e.message);
  };
  const first = Math.min(byBytes, AI_MAX_RESERVATION_USD);
  let row = await reserve(first);
  let estimate = first;
  if (row.status === "ok" && row.usage_id) {
    if (opts.countTokens) {
      // ② 数え直す（count_tokens は無料。数えられなければバイト数のまま）。予約の額は下げるだけ
      const counted = await estimateRequestUsd(opts.call, opts.request, opts.countTokens);
      if (counted > AI_MAX_RESERVATION_USD) {
        await drop(row.usage_id);
        return { ok: false, message: TOO_LARGE_MESSAGE };
      }
      if (counted < estimate) {
        const { error: e } = await admin.from("ai_usage").update({ cost_usd: counted }).eq("id", row.usage_id).eq("status", "reserved");
        if (e) console.error("[ai-budget] 予約の額を直せませんでした（大きめの見込みのまま）", e.message);
        else estimate = counted;
      }
    }
  } else if (opts.countTokens && row.status !== "daily_limit") {
    // バイト数の見込みが大きすぎて断られたのかもしれない。いちばん小さい見込み（入力 1 トークン）でも断られるなら、数えずに断る
    const floor = reserveEstimateUsd(opts.call, opts.request, 1);
    if (floor < first) {
      const probe = await reserve(floor);
      if (probe.status === "ok" && probe.usage_id) {
        await drop(probe.usage_id);
        const counted = await estimateRequestUsd(opts.call, opts.request, opts.countTokens);
        if (counted > AI_MAX_RESERVATION_USD) return { ok: false, message: TOO_LARGE_MESSAGE };
        row = await reserve(counted);
        estimate = counted;
      } else row = probe;
    }
  }
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
  const r = await reserveAi(admin, { ...opts, request, countTokens: tokenCounterOf(call) });
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
