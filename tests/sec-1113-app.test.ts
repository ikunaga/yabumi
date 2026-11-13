// セキュリティ確認 2026-11-13 のアプリの Low（fix/sec-1113-app）: App-L1 全体の上限の判定から全体の残りの額がわからない・App-L5 整えるに渡す穴の言葉は 16 個まで
import { describe, expect, it, vi } from "vitest";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";
import { X_MAX_POST_COST_USD, judgeXSend } from "@/lib/sns/x/send-rules";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } } }) } }) }));

describe("App-L1: 全体の上限は、この投稿の額によらず同じ答え", () => {
  const base = { userSpentUsd: 0, userBudgetUsd: 1, budgetUsd: 3 };
  const costs = [X_PRICE_USD.post, X_PRICE_USD.post + X_PRICE_USD.media_metadata, X_PRICE_USD.post_with_url, X_MAX_POST_COST_USD];
  it("全体の残りがいちばん高い 1 本分より少なければ、どの額でも global。足りれば、どの額でも当たらない", () => {
    for (const totalSpentUsd of [2.75, 2.79, 2.9, 2.995]) {
      const answers = new Set(costs.map((costUsd) => judgeXSend({ ...base, totalSpentUsd, costUsd })));
      expect(answers.size, `total ${totalSpentUsd}`).toBe(1);
    }
    expect(judgeXSend({ ...base, totalSpentUsd: 2.79, costUsd: X_PRICE_USD.post })).toBe("global");
    expect(judgeXSend({ ...base, totalSpentUsd: 2.75, costUsd: X_PRICE_USD.post })).toBeNull();
  });
  it("いちばん高い 1 本分は、URL あり＋説明文のある画像 4 枚", () => {
    expect(X_MAX_POST_COST_USD).toBeCloseTo(X_PRICE_USD.post_with_url + 4 * X_PRICE_USD.media_metadata);
  });
  it("利用者ごとの上限は、本人の額なので、この投稿の額で見る（いままでどおり）", () => {
    expect(judgeXSend({ ...base, budgetUsd: null, totalSpentUsd: 0, userSpentUsd: 0.9, costUsd: X_PRICE_USD.post })).toBeNull();
    expect(judgeXSend({ ...base, budgetUsd: null, totalSpentUsd: 0, userSpentUsd: 0.9, costUsd: X_PRICE_USD.post_with_url })).toBe("user");
  });
});

describe("App-L5: 整えるに渡す穴の言葉は 16 個まで", () => {
  const post = async (values: Record<string, string>) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "dummy");
    vi.stubEnv("SUPABASE_SECRET_KEY", "dummy");
    // AI の鍵がないので、形が合っても AI には届かない（「AI はまだ準備中です」）
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { POST } = await import("@/app/api/ai/tidy-draft/route");
    const body = JSON.stringify({ projectId: crypto.randomUUID(), text: "", sns: ["x"], format: { id: crypto.randomUUID(), values } });
    return POST(new Request("https://yabumi.app/api/ai/tidy-draft", { method: "POST", headers: { host: "yabumi.app", origin: "https://yabumi.app", "content-type": "application/json" }, body }));
  };
  const values = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`穴${i}`, "言葉"]));
  it("17 個は形が正しくないとして断る。16 個は受ける", async () => {
    expect((await post(values(17))).status).toBe(400);
    const ok = await post(values(16));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ error: "AI はまだ準備中です。" });
  });
});
