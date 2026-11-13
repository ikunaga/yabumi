// 投稿をつくるの X の上限の見込み（checkXSend）で読む額は、利用者ごとに 1 分 20 回まで読み直す（2026-11-13 の 2 回目のセキュリティ確認 App-L2）
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cachedXSpend, clearXSpendCache, X_SPEND_CACHE_MAX, X_SPEND_LOADS_PER_WINDOW, X_SPEND_WINDOW_MS } = await import("@/lib/sns/x/spend-cache");

const T0 = Date.parse("2026-11-13T03:00:00Z");
const counter = () => {
  let n = 0;
  return { load: () => Promise.resolve({ mine: ++n, total: n * 10 }), count: () => n };
};

beforeEach(() => clearXSpendCache());

describe("X の額の読み直しの回数", () => {
  it("1 分 20 回までは毎回読み直し（押したときも今の額）、超えたらその分の終わりまで最後の額を返す", async () => {
    const c = counter();
    for (let i = 0; i < X_SPEND_LOADS_PER_WINDOW; i++) expect((await cachedXSpend("u1", c.load, T0 + i)).mine).toBe(i + 1);
    expect(c.count()).toBe(X_SPEND_LOADS_PER_WINDOW);
    for (let i = 0; i < 50; i++) expect((await cachedXSpend("u1", c.load, T0 + 100 + i)).mine).toBe(X_SPEND_LOADS_PER_WINDOW);
    expect(c.count()).toBe(X_SPEND_LOADS_PER_WINDOW);
    // 1 分たてば、また読み直す
    expect((await cachedXSpend("u1", c.load, T0 + X_SPEND_WINDOW_MS)).mine).toBe(X_SPEND_LOADS_PER_WINDOW + 1);
  });
  it("ほかの利用者の回数・額は使わない。同時の呼び出しは 1 本にまとめる", async () => {
    const c = counter();
    for (let i = 0; i < X_SPEND_LOADS_PER_WINDOW + 5; i++) await cachedXSpend("u1", c.load, T0);
    const before = c.count();
    const [a, b] = await Promise.all([cachedXSpend("u2", c.load, T0), cachedXSpend("u2", c.load, T0)]);
    expect(a).toEqual(b);
    expect(a.mine).toBe(before + 1);
    expect(c.count()).toBe(before + 1);
  });
  it("日本時間の月が替わったら、回数を超えていても読み直す", async () => {
    const c = counter();
    const end = Date.parse("2026-11-30T14:59:30Z"); // 日本時間 11/30 23:59:30
    for (let i = 0; i < X_SPEND_LOADS_PER_WINDOW; i++) await cachedXSpend("u1", c.load, end);
    await cachedXSpend("u1", c.load, end + 40_000); // 日本時間 12/1
    expect(c.count()).toBe(X_SPEND_LOADS_PER_WINDOW + 1);
  });
  it("読めなかったときは覚えない（次は読み直す）", async () => {
    let n = 0;
    const load = () => (++n === 1 ? Promise.reject(new Error("db")) : Promise.resolve({ mine: 0, total: 0 }));
    await expect(cachedXSpend("u1", load, T0)).rejects.toThrow("db");
    await Promise.resolve();
    expect(await cachedXSpend("u1", load, T0 + 1)).toEqual({ mine: 0, total: 0 });
    expect(n).toBe(2);
  });
  it("覚える利用者の数には上限があり、古いものから捨てる", async () => {
    const c = counter();
    for (let i = 0; i <= X_SPEND_CACHE_MAX; i++) await cachedXSpend(`u${i}`, c.load, T0);
    expect(c.count()).toBe(X_SPEND_CACHE_MAX + 1);
  });
});
