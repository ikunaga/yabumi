// AI の費用の上限の判定（docs/architecture.md の 4.9）。行が多くても数え漏れないこと。本物の AI は呼ばない
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAiLimits } from "@/lib/ai/limits";
import { adminClient, deleteUser, signUpNewUser } from "./helpers/supabase";

const admin = adminClient();
let aliceId: string;

beforeAll(async () => {
  ({ userId: aliceId } = await signUpNewUser());
});

afterAll(async () => {
  await admin.from("ai_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
});

describe("AI の費用の上限", () => {
  it("今月の行が 1,000 を超えても、利用者の回数と費用を数え漏れない（API が 1 回に返す行の上限を超えても）", async () => {
    const rows = Array.from({ length: 1100 }, () => ({ owner_id: aliceId, purpose: "account_plan", model: "m", cost_usd: 0.001 }));
    const { error } = await admin.from("ai_usage").insert(rows);
    expect(error).toBeNull();
    const roomy = { userMonthlyUsd: 1000, globalMonthlyUsd: 1_000_000, userDailyTurns: 100_000 };
    expect(await checkAiLimits(admin, aliceId, { ...roomy, userDailyTurns: 1100 })).toMatchObject({ ok: false });
    expect(await checkAiLimits(admin, aliceId, { ...roomy, userDailyTurns: 1101 })).toEqual({ ok: true });
    // 1,100 行 × $0.001 = $1.1
    expect(await checkAiLimits(admin, aliceId, { ...roomy, userMonthlyUsd: 1.1 })).toMatchObject({ ok: false });
    expect(await checkAiLimits(admin, aliceId, { ...roomy, userMonthlyUsd: 1.2 })).toEqual({ ok: true });
  }, 30_000);

  it("合計の関数は、ログインした利用者からは呼べない", async () => {
    const { client, userId } = await signUpNewUser();
    const r = await client.rpc("ai_usage_totals", { p_owner_id: aliceId, p_month_start: new Date(0).toISOString(), p_day_start: new Date(0).toISOString() });
    expect(r.error).not.toBeNull();
    await deleteUser(userId);
  });
});
