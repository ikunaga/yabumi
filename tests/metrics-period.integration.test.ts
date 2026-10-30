// 分析の期間の切り替え（数字の段 2）の DB の関数: metrics_period_totals・link_clicks_by_sns_period。
// 7 日と 30 日で「直近」と「その前」の分け方が変わること、7・30 以外は弾くこと、他人とログインしていない人には数えないこと
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShortLink, recordClick } from "@/lib/links/store";
import { anonClient, adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const STORE = "https://apps.apple.com/jp/app/id123456789";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const ymdAgo = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(Date.now() - n * 86_400_000));

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

async function publishedPost(sns: string, publishedAt: string) {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "本文",
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns, title: sns === "note" ? "題" : null }],
  });
  if (error) throw error;
  await admin.from("post_targets").update({ status: "published", published_at: publishedAt }).eq("post_id", postId!).eq("sns", sns);
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "期間" }).select("id").single()).data!.id;
  // 送った投稿: 2・9・20 日前
  await publishedPost("x", daysAgo(2));
  await publishedPost("threads", daysAgo(9));
  await publishedPost("x", daysAgo(20));
  // ストアのダウンロード: 1・10・40 日前（ストアの行はサーバーだけが書く）
  const store = [
    [1, 5],
    [10, 7],
    [40, 11],
  ].map(([n, downloads]) => ({ owner_id: aliceId, project_id: projectId, source: "app_store", day: ymdAgo(n), values: { downloads } }));
  const { error } = await admin.from("store_daily").insert(store);
  if (error) throw error;
  // クリック: X のプロフィールのリンクに 2 回（今日）
  const xLink = await createShortLink(admin, { ownerId: aliceId, projectId, destinationUrl: STORE, sns: "x", kind: "profile" });
  for (const ip of ["203.0.113.11", "203.0.113.12"]) {
    await recordClick(admin, { linkId: xLink.id, ip, userAgent: IPHONE, device: "ios", country: "JP", excluded: null });
  }
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("期間ごとの合計（metrics_period_totals）", () => {
  it("7 日は直近 7 日とその前の 7 日、30 日は直近 30 日とその前の 30 日に分ける", async () => {
    const week = (await alice.rpc("metrics_period_totals", { p_project_id: projectId, p_today: today(), p_days: 7 })).data![0];
    expect(week).toMatchObject({ published_now: 1, published_prev: 1, downloads_now: 5, downloads_prev: 7 });
    const month = (await alice.rpc("metrics_period_totals", { p_project_id: projectId, p_today: today(), p_days: 30 })).data![0];
    expect(month).toMatchObject({ published_now: 3, published_prev: 0, downloads_now: 12, downloads_prev: 11 });
  });

  it("7 日と 30 日のほかは弾く。他人には数えず、ログインしていない人は呼べない", async () => {
    expect((await alice.rpc("metrics_period_totals", { p_project_id: projectId, p_today: today(), p_days: 14 })).error?.code).toBe("22023");
    expect((await alice.rpc("link_clicks_by_sns_period", { p_project_id: projectId, p_today: today(), p_days: 90 })).error?.code).toBe("22023");
    expect((await bob.rpc("metrics_period_totals", { p_project_id: projectId, p_today: today(), p_days: 30 })).data![0]).toMatchObject({ published_now: 0, downloads_now: 0 });
    expect((await bob.rpc("link_clicks_by_sns_period", { p_project_id: projectId, p_today: today(), p_days: 30 })).data).toEqual([]);
    expect((await anonClient().rpc("metrics_period_totals", { p_project_id: projectId, p_today: today(), p_days: 7 })).error?.code).toBe("42501");
  });
});

describe("SNS ごとのクリック（link_clicks_by_sns_period）", () => {
  it("直近の期間とその前、30 日を SNS ごとに数える", async () => {
    const { data } = await alice.rpc("link_clicks_by_sns_period", { p_project_id: projectId, p_today: today(), p_days: 30 });
    expect(data).toEqual([{ sns: "x", clicks_now: 2, clicks_prev: 0, last_30d: 2 }]);
  });
});
