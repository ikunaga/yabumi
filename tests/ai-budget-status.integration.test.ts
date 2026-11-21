// AI の枠の状態（20261121130000・130100 の ai_budget_status・ai_budget_status_of。2026-11-21 オーナーの依頼「使い切ったら、相談の一覧の上のほうに、いつ使えるかを」）
// - 数え方は予約（reserve_ai_usage）と同じ ai_budget_check。金額は返さず、状態・また使える日・残り少しかだけ
// - 権限: ai_budget_status は本人（authenticated）だけ。ai_budget_status_of は service_role だけ。ai_budget_check はだれも呼べない
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spendAi, unspendAi } from "./helpers/ai-budget";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let aliceCreated: string;
let bobId: string;
let carolId: string;
const spent: string[] = [];

const jst = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
const todayJst = () => jst(new Date());
const addDaysYmd = (ymd: string, n: number) => jst(new Date(Date.parse(`${ymd}T12:00:00+09:00`) + n * 86_400_000));
const firstOfNextMonth = () => {
  const [y, m] = todayJst().split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

// 本人の状態（ログインした本人で呼ぶ）
async function mine(client: TestClient) {
  const { data, error } = await client.rpc("ai_budget_status", { p_purpose: "consult" });
  if (error) throw error;
  return data[0];
}
// 7 日を過ぎた人として数える（service_role だけ）
async function ordinary(userId: string) {
  const { data, error } = await admin.rpc("ai_budget_status_of", { p_owner_id: userId, p_purpose: "consult", p_as_of: "2100-01-01T00:00:00Z", p_scope_owner: userId } as never);
  if (error) throw error;
  return data[0];
}
async function spend(userId: string, usd: number) {
  spent.push(...(await spendAi(admin, userId, usd)));
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  ({ userId: carolId } = await signUpNewUser());
  const { data } = await admin.auth.admin.getUserById(aliceId);
  aliceCreated = data.user!.created_at;
});

afterAll(async () => {
  await unspendAi(admin, spent);
  for (const id of [aliceId, bobId, carolId]) await admin.from("ai_usage").delete().eq("owner_id", id);
  await Promise.all([aliceId, bobId, carolId].map((id) => deleteUser(id)));
});

describe("AI の枠の状態（権限）", () => {
  it("ai_budget_status はログインした本人だけが呼べる（ログインしていない人は呼べない）", async () => {
    expect((await anonClient().rpc("ai_budget_status", { p_purpose: "consult" })).error).not.toBeNull();
    expect((await alice.rpc("ai_budget_status", { p_purpose: "consult" })).error).toBeNull();
  });

  it("ai_budget_status_of は service_role だけ（本人も他人の id でも呼べない）", async () => {
    expect((await alice.rpc("ai_budget_status_of", { p_owner_id: aliceId, p_purpose: "consult" })).error?.code).toBe("42501");
    expect((await alice.rpc("ai_budget_status_of", { p_owner_id: bobId, p_purpose: "consult" })).error?.code).toBe("42501");
    expect((await anonClient().rpc("ai_budget_status_of", { p_owner_id: aliceId, p_purpose: "consult" })).error).not.toBeNull();
    expect((await admin.rpc("ai_budget_status_of", { p_owner_id: aliceId, p_purpose: "consult" })).error).toBeNull();
  });

  it("ai_budget_check は、だれも呼べない（service_role も）", async () => {
    const args = { p_owner_id: aliceId, p_purpose: "consult", p_cost_usd: 0 };
    expect((await alice.rpc("ai_budget_check" as never, args as never)).error).not.toBeNull();
    expect((await anonClient().rpc("ai_budget_check" as never, args as never)).error).not.toBeNull();
    expect((await admin.rpc("ai_budget_check" as never, args as never)).error).not.toBeNull();
  });

  it("金額は返さない（状態・また使える日・残り少しかだけ）。自動の投稿の用途は断る", async () => {
    expect(Object.keys(await mine(alice)).sort()).toEqual(["available_from", "low", "status"]);
    expect((await alice.rpc("ai_budget_status", { p_purpose: "auto_post" })).error?.code).toBe("22023");
  });
});

describe("AI の枠の状態（数え方）", () => {
  it("登録して 7 日までの人（枠 $3.3・相談の下限 $0.15）: $2.82 から残り少し、$3.15 をこえると使えない（7 日を過ぎた日から使える）", async () => {
    expect(await mine(alice)).toEqual({ status: "ok", available_from: null, low: false });
    await spend(aliceId, 2.81);
    expect((await mine(alice)).low).toBe(false);
    await spend(aliceId, 0.01);
    expect(await mine(alice)).toEqual({ status: "ok", available_from: null, low: true });
    await spend(aliceId, 0.34);
    expect(await mine(alice)).toEqual({ status: "new_user_limit", available_from: jst(new Date(Date.parse(aliceCreated) + 7 * 86_400_000)), low: false });
  });

  it("7 日を過ぎた人（枠 $9.9）: $8.76 から残り少し、$9.75 をこえると来月 1 日まで使えない", async () => {
    // 全体の合計は共有の DB のすべての人で数えるので、前のテストのアリスの分を消してから（全体の $10 より先に本人の $9.9 に当たるように）
    await admin.from("ai_usage").delete().eq("owner_id", aliceId);
    await spend(bobId, 8.75);
    expect((await ordinary(bobId)).low).toBe(false);
    await spend(bobId, 0.01);
    expect(await ordinary(bobId)).toEqual({ status: "ok", available_from: null, low: true });
    await spend(bobId, 1);
    expect(await ordinary(bobId)).toEqual({ status: "user_limit", available_from: firstOfNextMonth(), low: false });
  });

  it("1 日の往復（60 回）を使い切ると、明日から使える", async () => {
    const rows = Array.from({ length: 60 }, () => ({ owner_id: carolId, purpose: "test_fill", model: "test", cost_usd: 0.001 }));
    const { data, error } = await admin.from("ai_usage").insert(rows).select("id");
    if (error) throw error;
    spent.push(...data.map((r) => r.id));
    expect(await ordinary(carolId)).toEqual({ status: "daily_limit", available_from: addDaysYmd(todayJst(), 1), low: false });
  });
});
