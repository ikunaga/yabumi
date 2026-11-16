// 自動の投稿の AI の枠（DB の関数 reserve_ai_usage。20261116110000_auto_post_ai_budget。docs/design/auto-post.md の A4）。
// 自動の投稿（auto_post・auto_post_check）は、ふだんの枠と別に数える: 利用者 月 $3・全体 月 $5・1 人 1 日に作る回数 10 回、新しい人は 3 分の 1。
// 全体の合計は p_scope_owner で、このテストの利用者の分だけに絞る（共有のローカル DB のほかのテストに左右されない）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, deleteUser, signUpNewUser } from "./helpers/supabase";

const admin = adminClient();
const OLD = "2100-01-01T00:00:00Z"; // 登録から 7 日を過ぎた人として数える時点
let aliceId: string;
let bobId: string;

const reserve = (owner: string, purpose: string, over: { cost?: number; asOf?: string | null; scope?: string } = {}) =>
  admin.rpc("reserve_ai_usage", {
    p_owner_id: owner,
    p_purpose: purpose,
    p_cost_usd: over.cost ?? 0.2,
    p_scope_owner: over.scope ?? owner,
    ...(over.asOf === null ? {} : { p_as_of: over.asOf ?? OLD }),
  });

async function spend(owner: string, purpose: string, usd: number, count = 1, byNewUser = false) {
  const rows = Array.from({ length: count }, () => ({ owner_id: owner, purpose, model: "test", cost_usd: usd / count, by_new_user: byNewUser }));
  const { error } = await admin.from("ai_usage").insert(rows);
  if (error) throw error;
}

const clear = async () => {
  await admin.from("ai_usage").delete().in("owner_id", [aliceId, bobId]);
};

beforeAll(async () => {
  ({ userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await clear();
  await deleteUser(aliceId);
  await deleteUser(bobId);
  const { count } = await admin.from("ai_usage").select("*", { count: "exact", head: true }).in("owner_id", [aliceId, bobId]);
  expect(count).toBe(0);
});

describe("自動の投稿の AI の枠", () => {
  it("ふだんの枠を使い切っていても、自動の投稿は使える（逆も同じ）", async () => {
    await clear();
    await spend(aliceId, "consult", 2.95);
    expect((await reserve(aliceId, "consult")).data?.[0]?.status).toBe("user_limit");
    expect((await reserve(aliceId, "auto_post")).data?.[0]?.status).toBe("ok");
    await clear();
    await spend(aliceId, "auto_post", 2.95);
    expect((await reserve(aliceId, "auto_post")).data?.[0]?.status).toBe("user_limit");
    expect((await reserve(aliceId, "auto_post_check")).data?.[0]?.status).toBe("user_limit");
    expect((await reserve(aliceId, "consult")).data?.[0]?.status).toBe("ok");
  });

  it("利用者は月 $3（同時に予約しても超えない）。下限は auto_post 0.13・auto_post_check 0.15", async () => {
    await clear();
    await spend(aliceId, "auto_post", 2.6);
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve(aliceId, "auto_post", { cost: 0.01 })));
    expect(results.filter((r) => r.data?.[0]?.status === "ok")).toHaveLength(3);
    const rows = (await admin.from("ai_usage").select("cost_usd").eq("owner_id", aliceId).eq("status", "reserved")).data!;
    expect(rows.map((r) => Number(r.cost_usd))).toEqual([0.13, 0.13, 0.13]);
    await clear();
    expect((await reserve(aliceId, "auto_post_check", { cost: 0.01 })).data?.[0]?.status).toBe("ok");
    expect(Number((await admin.from("ai_usage").select("cost_usd").eq("owner_id", aliceId).eq("purpose", "auto_post_check").single()).data!.cost_usd)).toBe(0.15);
  });

  it("全体は月 $5（ふだんの用途の分は数えない）", async () => {
    await clear();
    await spend(bobId, "consult", 9);
    await spend(bobId, "auto_post", 4.9);
    // alice と bob の 2 人の分だけで全体を数える
    expect((await reserve(aliceId, "auto_post", { scope: bobId })).data?.[0]?.status).toBe("global_limit");
    expect((await reserve(aliceId, "consult", { scope: bobId, cost: 0.5 })).data?.[0]?.status).toBe("ok");
  });

  it("1 人 1 日に作る（auto_post）のは 10 回まで。チェック（auto_post_check）はその数に入らない。ふだんの 1 日 60 往復にも入らない", async () => {
    await clear();
    await spend(aliceId, "auto_post", 0.1, 10);
    expect((await reserve(aliceId, "auto_post")).data?.[0]?.status).toBe("daily_limit");
    expect((await reserve(aliceId, "auto_post_check")).data?.[0]?.status).toBe("ok");
    await clear();
    await spend(aliceId, "consult", 0.6, 60);
    expect((await reserve(aliceId, "consult")).data?.[0]?.status).toBe("daily_limit");
    expect((await reserve(aliceId, "auto_post")).data?.[0]?.status).toBe("ok");
  });

  it("登録して 7 日までの人は、利用者・全体とも 3 分の 1", async () => {
    await clear();
    await spend(aliceId, "auto_post", 0.95);
    expect((await reserve(aliceId, "auto_post", { asOf: null })).data?.[0]?.status).toBe("new_user_limit");
    await clear();
    await spend(bobId, "auto_post", 1.6, 1, true);
    expect((await reserve(aliceId, "auto_post", { asOf: null, scope: bobId })).data?.[0]?.status).toBe("new_global_limit");
    // ふだんの用途の新しい人の枠は、自動の投稿の分を数えない
    expect((await reserve(aliceId, "consult", { asOf: null, scope: bobId })).data?.[0]?.status).toBe("ok");
  });
});
