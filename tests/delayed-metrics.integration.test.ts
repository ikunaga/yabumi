// 遅れて届くストアの数字を、すべてのストアから届いているいちばん新しい日で終わる期間で数える（loadStoreTotals・loadMetricsOverview）。
// 届いていない日を 0 として足して「減った」と見せない。他人の数字は数えない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

// 分析の読み込み（server-only）をテストから呼ぶ
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("テストではクライアントを渡す");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("テストでは使わない");
  },
}));

const admin = adminClient();
const ymdAgo = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(Date.now() - n * 86_400_000));
const today = () => ymdAgo(0);

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let emptyProjectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "遅れて届く" }).select("id").single()).data!.id;
  emptyProjectId = (await alice.from("projects").insert({ name: "まだ届かない" }).select("id").single()).data!.id;
  // App Store は 1 日前まで、Google Play は 3 日前まで届いている（40 日前から取り込んでいる）。どちらも 1 日 10 件、ページの閲覧は 1 日 2 回
  const rows = [];
  for (let n = 1; n <= 40; n++) rows.push({ owner_id: aliceId, project_id: projectId, source: "app_store", day: ymdAgo(n), values: { downloads: 10 } });
  for (let n = 3; n <= 40; n++) rows.push({ owner_id: aliceId, project_id: projectId, source: "google_play", day: ymdAgo(n), values: { downloads: 10, page_views: 2 } });
  const { error } = await admin.from("store_daily").insert(rows);
  if (error) throw error;
  // 取り込んだことはあるが、直近 60 日には届いていない
  const old = await admin.from("store_daily").insert({ owner_id: aliceId, project_id: emptyProjectId, source: "app_store", day: ymdAgo(90), values: { downloads: 1 } });
  if (old.error) throw old.error;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("届いている日で終わる期間（loadStoreTotals）", () => {
  it("すべてのストアから届いている 3 日前で終わる 7 日とその前の 7 日を数え、終わりの日を持つ", async () => {
    const { loadStoreTotals } = await import("@/lib/metrics/queries");
    const v = await loadStoreTotals(alice, projectId, today(), 7);
    // 今日で終わる 7 日なら App Store の 6 日分と Google Play の 5 日分で 110 になり、減ったように見える
    expect(v.downloads).toEqual({ thisWeek: 140, lastWeek: 140, until: ymdAgo(3) });
    expect(v.store_page_views).toEqual({ thisWeek: 14, lastWeek: 14, until: ymdAgo(3) });
  });

  it("30 日は、前の 30 日が数え始める前にかかるので比べない", async () => {
    const { loadStoreTotals } = await import("@/lib/metrics/queries");
    const v = await loadStoreTotals(alice, projectId, today(), 30);
    expect(v.downloads).toMatchObject({ thisWeek: 600, noPrev: true, until: ymdAgo(3) });
  });

  it("直近に届いていなければ数を出さない。取り込んだことがなければ出さない。他人には数えない", async () => {
    const { loadStoreTotals } = await import("@/lib/metrics/queries");
    expect((await loadStoreTotals(alice, emptyProjectId, today(), 7)).downloads).toEqual({ thisWeek: 0, lastWeek: 0, notArrived: true });
    expect(await loadStoreTotals(bob, projectId, today(), 7)).toEqual({});
  });

  it("分析の数字（loadMetricsOverview）も同じ値", async () => {
    const { loadMetricsOverview } = await import("@/lib/metrics/queries");
    const o = await loadMetricsOverview(projectId, alice, 7);
    expect(o.kpiValues.downloads).toEqual({ thisWeek: 140, lastWeek: 140, until: ymdAgo(3) });
  });
});

describe("DB の関数 store_period_totals", () => {
  it("終わりの日より後の行は入れない（App Store だけ届いている 1・2 日前を混ぜない）", async () => {
    const { data, error } = await alice.rpc("store_period_totals", { p_project_id: projectId, p_end: ymdAgo(3), p_days: 7 });
    expect(error).toBeNull();
    expect(data![0]).toMatchObject({ downloads_now: 140, downloads_prev: 140, page_views_now: 14, page_views_prev: 14 });
  });

  it("7 日と 30 日のほかは弾く。他人には数えず、ログインしていない人は呼べない", async () => {
    expect((await alice.rpc("store_period_totals", { p_project_id: projectId, p_end: ymdAgo(3), p_days: 14 })).error?.code).toBe("22023");
    expect((await bob.rpc("store_period_totals", { p_project_id: projectId, p_end: ymdAgo(3), p_days: 7 })).data![0]).toMatchObject({ downloads_now: 0, page_views_now: 0 });
    expect((await anonClient().rpc("store_period_totals", { p_project_id: projectId, p_end: ymdAgo(3), p_days: 7 })).error?.code).toBe("42501");
  });

  it("終わりの日が先の日でも、本人の行しか数えない", async () => {
    const future = ymdAgo(-20);
    // 先の日で終わる 30 日には、1〜9 日前（App Store 9 日・Google Play 7 日）が入る
    expect((await alice.rpc("store_period_totals", { p_project_id: projectId, p_end: future, p_days: 30 })).data![0]).toMatchObject({ downloads_now: 160 });
    expect((await bob.rpc("store_period_totals", { p_project_id: projectId, p_end: future, p_days: 30 })).data![0]).toMatchObject({ downloads_now: 0, downloads_prev: 0, page_views_now: 0, page_views_prev: 0 });
  });
});
