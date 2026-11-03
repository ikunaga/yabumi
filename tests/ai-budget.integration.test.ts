// 文章の AI の上限の予約（DB の関数 reserve_ai_usage と src/lib/ai/budget.ts。セキュリティ確認 2026-11-03 の M2・M1）。
// 同時に送っても本人と全体の上限を超えない・断った分を数えない・新しい人の枠・呼べるのはサーバーだけ。本物の AI は呼ばない。
// 全体の合計は p_scope_owner で、このテストの利用者の分だけに絞る（共有のローカル DB のほかのテストに左右されない）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AI_MAX_TOKENS, COUNTED_TOKENS_MARGIN, REQUEST_OVERHEAD_TOKENS, countable, reserveEstimateUsd, setAiBudgetTestScope, withAiBudget } from "@/lib/ai/budget";
import { AiRequestRejected, AiUnavailableError } from "@/lib/ai/provider-failure";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const OLD = "2100-01-01T00:00:00Z"; // 登録からの日数を数える時点（7 日を過ぎた人として）
const COST = 0.25; // 予約の見込み（相談の下限 $0.15 より大きい）

let alice: TestClient;
let aliceId: string;
let bobId: string;

const reserve = (owner: string, over: { scope?: string; asOf?: string | null; cost?: number; purpose?: string } = {}) =>
  admin.rpc("reserve_ai_usage", {
    p_owner_id: owner,
    p_purpose: over.purpose ?? "consult",
    p_cost_usd: over.cost ?? COST,
    p_scope_owner: over.scope ?? owner,
    ...(over.asOf === null ? {} : { p_as_of: over.asOf ?? OLD }),
  });

async function spend(owner: string, usd: number, extra: { by_new_user?: boolean; count?: number } = {}) {
  const count = extra.count ?? 1;
  const rows = Array.from({ length: count }, () => ({ owner_id: owner, purpose: "test_fill", model: "test", cost_usd: usd / count, by_new_user: extra.by_new_user ?? false }));
  const { error } = await admin.from("ai_usage").insert(rows);
  if (error) throw error;
}

const clear = async (...owners: string[]) => {
  await admin.from("ai_usage").delete().in("owner_id", owners);
};

const rowsOf = async (owner: string) => (await admin.from("ai_usage").select("id, cost_usd, status, by_new_user").eq("owner_id", owner)).data!;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  setAiBudgetTestScope(null);
  await clear(aliceId, bobId);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("予約（reserve_ai_usage）", () => {
  it("同時に 10 回送っても、本人の月の上限（$3）を超えない。断った分は行を作らない", async () => {
    await clear(aliceId, bobId);
    await spend(aliceId, 2.5);
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(aliceId)));
    const statuses = results.map((r) => r.data?.[0]?.status);
    expect(statuses.filter((s) => s === "ok")).toHaveLength(2);
    expect(statuses.filter((s) => s === "user_limit")).toHaveLength(8);
    const rows = await rowsOf(aliceId);
    expect(rows.filter((r) => r.status === "reserved")).toHaveLength(2);
    expect(rows.reduce((n, r) => n + Number(r.cost_usd), 0)).toBeCloseTo(3, 6);
  });

  it("同時に 10 回送っても、全体の月の上限（$10）を超えない", async () => {
    await clear(aliceId, bobId);
    // 全体はボブとアリスの分で数える。ボブが $9.5 使っていて、アリスが同時に 10 回（$0.25 ずつ。本人の上限 $3 には届かない）
    await spend(bobId, 9.5);
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(aliceId, { scope: bobId })));
    const statuses = results.map((r) => r.data?.[0]?.status);
    expect(statuses.filter((s) => s === "ok")).toHaveLength(2);
    expect(statuses.filter((s) => s === "global_limit")).toHaveLength(8);
    const total = [...(await rowsOf(aliceId)), ...(await rowsOf(bobId))].reduce((n, r) => n + Number(r.cost_usd), 0);
    expect(total).toBeCloseTo(10, 6);
    await clear(aliceId, bobId);
    await spend(aliceId, 9.95);
    // 全体の残りが見込みより少なければ、本人の上限より先に全体が断る
    expect((await reserve(aliceId)).data?.[0]?.status).toBe("global_limit");
    expect(await rowsOf(aliceId)).toHaveLength(1);
  });

  it("1 日 60 回まで。1,000 行を超えても数え漏れない", async () => {
    await clear(aliceId, bobId);
    await spend(aliceId, 1.1, { count: 1100 });
    expect((await reserve(aliceId)).data?.[0]?.status).toBe("daily_limit");
    await clear(aliceId);
    await spend(aliceId, 2.8, { count: 1100 });
    expect((await reserve(aliceId)).data?.[0]?.status).toBe("user_limit");
  }, 30_000);

  it("新しい人（登録して 7 日まで）は、本人の月の上限が 3 分の 1（$1）。いつ戻るかを返し、予約の行に印を付ける", async () => {
    await clear(aliceId, bobId);
    const { data: u } = await admin.auth.admin.getUserById(aliceId);
    const until = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(new Date(u.user!.created_at).getTime() + 7 * 86_400_000));
    const ok = (await reserve(aliceId, { asOf: null })).data![0];
    expect(ok).toMatchObject({ status: "ok", new_until: until });
    expect((await rowsOf(aliceId))[0]).toMatchObject({ status: "reserved", by_new_user: true });
    await spend(aliceId, 0.6);
    // $0.25 + $0.6 + $0.25 > $1
    expect((await reserve(aliceId, { asOf: null })).data![0]).toMatchObject({ status: "new_user_limit", new_until: until });
    // 7 日を過ぎた人としてなら通る（普段の $3）
    expect((await reserve(aliceId)).data![0]).toMatchObject({ status: "ok", new_until: null });
  });

  it("新しい人たち全体で使えるのは、全体の月の枠の 3 分の 1（$3.33）まで。新しいときに使った分で数える（退会しても戻らない）", async () => {
    await clear(aliceId, bobId);
    // ボブが新しいうちに $3.3 使った（印の付いた行）。全体はボブの分で数える
    await spend(bobId, 3.2, { by_new_user: true });
    expect((await reserve(aliceId, { scope: bobId, asOf: null })).data![0].status).toBe("new_global_limit");
    // 新しい人でなければ、普段の全体の枠（$10）で数える
    expect((await reserve(aliceId, { scope: bobId })).data![0].status).toBe("ok");
    // 印のない行（7 日を過ぎてから使った分）は、新しい人たちの枠に数えない
    await clear(aliceId, bobId);
    await spend(bobId, 3.3);
    expect((await reserve(aliceId, { scope: bobId, asOf: null })).data![0].status).toBe("ok");
    // 退会して持ち主が空になっても、印の行は残って数える
    await clear(aliceId, bobId);
    await spend(bobId, 3.3, { by_new_user: true });
    const { data: orphan } = await admin.from("ai_usage").select("id").eq("owner_id", bobId);
    await admin.from("ai_usage").update({ owner_id: null }).in("id", orphan!.map((r) => r.id));
    const counted = await admin.rpc("reserve_ai_usage", { p_owner_id: aliceId, p_purpose: "consult", p_cost_usd: COST });
    // 全体（絞らない）では、共有の DB のほかの新しい人の行も入るので、少なくとも断られることだけを確かめる
    expect(counted.data![0].status).not.toBe("ok");
    await admin.from("ai_usage").delete().in("id", orphan!.map((r) => r.id));
  });

  it("呼べるのはサーバー（service_role）だけ。ログインした利用者・ログインしていない人は呼べず、ai_usage にも書けない", async () => {
    const args = { p_owner_id: aliceId, p_purpose: "consult", p_cost_usd: COST };
    expect((await alice.rpc("reserve_ai_usage", args)).error?.code).toBe("42501");
    expect((await anonClient().rpc("reserve_ai_usage", args)).error?.code).toBe("42501");
    // テスト用の引数（全体を絞る p_scope_owner・時点の p_as_of）も、利用者からは渡せない
    expect((await alice.rpc("reserve_ai_usage", { ...args, p_scope_owner: aliceId, p_as_of: OLD })).error?.code).toBe("42501");
    expect((await anonClient().rpc("reserve_ai_usage", { ...args, p_scope_owner: aliceId })).error?.code).toBe("42501");
    const insert = await alice.from("ai_usage").insert({ owner_id: aliceId, purpose: "x", model: "x", cost_usd: 0 });
    expect(insert.error).not.toBeNull();
  });

  it("見込みが 0 以下・1 回の上限（$1）を超える・知らない用途・知らない利用者は弾く。用途ごとの下限より小さい見込みは下限で予約する", async () => {
    await clear(aliceId, bobId);
    expect((await reserve(aliceId, { cost: 0 })).error?.code).toBe("22023");
    expect((await reserve(aliceId, { cost: 1.01 })).error?.code).toBe("22023");
    expect((await reserve(aliceId, { purpose: "test_budget" })).error?.code).toBe("22023");
    expect((await reserve("00000000-0000-0000-0000-000000000000")).error?.code).toBe("22023");
    expect(await rowsOf(aliceId)).toHaveLength(0);
    expect((await reserve(aliceId, { cost: 1 })).data?.[0]?.status).toBe("ok");
    expect((await reserve(aliceId, { cost: 0.01 })).data?.[0]?.status).toBe("ok");
    expect((await reserve(aliceId, { cost: 0.01, purpose: "account_plan" })).data?.[0]?.status).toBe("ok");
    expect((await rowsOf(aliceId)).map((r) => Number(r.cost_usd)).sort()).toEqual([0.15, 0.25, 1]);
  });
});

describe("入口（withAiBudget）", () => {
  const usage = { inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 100 };
  const request = { system: [{ type: "text", text: "相談の相棒です。" }], messages: [{ role: "user", content: [{ type: "text", text: "フォロワーを増やしたい" }] }] };
  const opts = () => ({ userId: aliceId, purpose: "consult", call: "consult" as const });

  it("見込みは送る中身と出力の上限から決めた最大の額。返事のあとで実際の額に直す。上限なら呼ばない", async () => {
    await clear(aliceId, bobId);
    setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(OLD) });
    let reserved: unknown;
    const ok = await withAiBudget(admin, opts(), request, async () => {
      reserved = (await rowsOf(aliceId))[0];
      return { model: "claude-opus-5-5", usage };
    });
    expect(ok.ok).toBe(true);
    expect(reserved).toMatchObject({ status: "reserved", cost_usd: reserveEstimateUsd("consult", request) });
    expect(await rowsOf(aliceId)).toEqual([expect.objectContaining({ status: "done", cost_usd: 0.006 })]);

    await spend(aliceId, 3);
    let called = false;
    const denied = await withAiBudget(admin, opts(), request, async () => {
      called = true;
      return { model: "claude-opus-5-5", usage };
    });
    expect(denied).toMatchObject({ ok: false, message: expect.stringContaining("今月") });
    expect(called).toBe(false);
    expect(await rowsOf(aliceId)).toHaveLength(2);
    setAiBudgetTestScope(null);
  });

  it("見込みが 1 回の上限（$1）を超える呼び出しは、予約も呼び出しもしない", async () => {
    await clear(aliceId, bobId);
    setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(OLD) });
    const huge = { system: [], messages: [{ role: "user", content: [{ type: "text", text: "あ".repeat(60_000) }] }] };
    let called = false;
    const r = await withAiBudget(admin, opts(), huge, async () => {
      called = true;
      return { model: "claude-opus-5-5", usage };
    });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("長すぎます") });
    expect(called).toBe(false);
    expect(await rowsOf(aliceId)).toHaveLength(0);
    setAiBudgetTestScope(null);
  });

  it("失敗したとき: 4xx（処理されずに断られた）と支払い・鍵の問題は予約を消す。5xx・タイムアウト・接続切れ・返事を読めないときは見込みの額のまま数える", async () => {
    await clear(aliceId, bobId);
    setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(OLD) });
    const estimate = reserveEstimateUsd("consult", request);
    for (const e of [new AiRequestRejected(400, "bad"), new AiRequestRejected(429, "rate"), new AiUnavailableError("anthropic", 402)]) {
      await expect(withAiBudget(admin, opts(), request, async () => Promise.reject(e))).rejects.toBe(e);
    }
    expect(await rowsOf(aliceId)).toHaveLength(0);
    const unknown = [new Error("timeout"), Object.assign(new Error("server"), { status: 500 }), new Error("fetch failed"), new Error("JSON parse")];
    for (const e of unknown) await expect(withAiBudget(admin, opts(), request, async () => Promise.reject(e))).rejects.toBe(e);
    const rows = (await admin.from("ai_usage").select("status, model, cost_usd").eq("owner_id", aliceId)).data!;
    expect(rows).toHaveLength(unknown.length);
    for (const r of rows) expect(r).toEqual({ status: "done", model: "failed", cost_usd: estimate });
    setAiBudgetTestScope(null);
  });

  it("残りが少ないときに同時に 10 回送っても、どれも最大の額がかかったとして実際の額に直したあとの合計が上限を超えない", async () => {
    await clear(aliceId, bobId);
    setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(OLD) });
    await spend(aliceId, 2); // 残り $1
    const long = { system: [{ type: "text", text: "相談の相棒です。".repeat(500) }], messages: [{ role: "user", content: [{ type: "text", text: "長い相談".repeat(1000) }] }] };
    const bytes = Buffer.byteLength(JSON.stringify(long), "utf8");
    // 起こりうる最大: 送る中身がすべてトークン（1 バイト 1 トークン）でキャッシュへの書き込み、出力は上限まで、知らないモデル（いちばん高い）
    const worst = { model: "unknown-fallback-model", usage: { inputTokens: 0, cacheWriteTokens: bytes + REQUEST_OVERHEAD_TOKENS, cacheReadTokens: 0, outputTokens: AI_MAX_TOKENS.consult } };
    const results = await Promise.all(Array.from({ length: 10 }, () => withAiBudget(admin, opts(), long, async () => worst)));
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(0);
    expect(results.filter((r) => !r.ok).length).toBeGreaterThan(0);
    const total = (await rowsOf(aliceId)).reduce((n, r) => n + Number(r.cost_usd), 0);
    expect(total).toBeLessThanOrEqual(3);
    setAiBudgetTestScope(null);
  });

  it("呼び出しに数える関数（count_tokens）が付いていれば、数えた値で予約する。数えられなければバイト数で予約する", async () => {
    await clear(aliceId, bobId);
    setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(OLD) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const long = { system: [{ type: "text", text: "相談の相棒です。".repeat(500) }], messages: [{ role: "user", content: [{ type: "text", text: "長い相談".repeat(1000) }] }] };
    const seen: number[] = [];
    const call = (count: () => Promise<number>) =>
      countable(async (req: typeof long) => {
        seen.push(Number((await rowsOf(aliceId)).find((r) => r.status === "reserved")?.cost_usd));
        void req;
        return { model: "claude-opus-5-5", usage };
      }, count);
    expect((await withAiBudget(admin, opts(), long, call(async () => 3000))).ok).toBe(true);
    expect((await withAiBudget(admin, opts(), long, call(async () => Promise.reject(new Error("count failed"))))).ok).toBe(true);
    expect(seen).toEqual([reserveEstimateUsd("consult", long, 3000), reserveEstimateUsd("consult", long)]);
    expect(seen[0]).toBeLessThan(seen[1]);
    vi.restoreAllMocks();
    setAiBudgetTestScope(null);
  });

  it("数えた値で予約しても、残りが少ないときに同時に 10 回送り、どれも数えた値のゆとりの分まで入力・出力の上限まで使ったとしても、合計が上限を超えない", async () => {
    await clear(aliceId, bobId);
    setAiBudgetTestScope({ scopeSelf: true, asOf: new Date(OLD) });
    await spend(aliceId, 2.2); // 残り $0.8
    const counted = 5000;
    const worst = { model: "unknown-fallback-model", usage: { inputTokens: 0, cacheWriteTokens: Math.ceil(counted * COUNTED_TOKENS_MARGIN), cacheReadTokens: 0, outputTokens: AI_MAX_TOKENS.consult } };
    const results = await Promise.all(Array.from({ length: 10 }, () => withAiBudget(admin, opts(), request, countable(async (req: typeof request) => (void req, worst), async () => counted))));
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(0);
    expect(results.filter((r) => !r.ok).length).toBeGreaterThan(0);
    const total = (await rowsOf(aliceId)).reduce((n, r) => n + Number(r.cost_usd), 0);
    expect(total).toBeLessThanOrEqual(3);
    setAiBudgetTestScope(null);
  });
});
