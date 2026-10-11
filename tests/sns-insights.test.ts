// SNS の数字の読み方と、数字の権限の求め方（docs/architecture.md の 4.22）。本物の SNS は呼ばない
import { describe, expect, it, vi } from "vitest";
import { facebookInsights, InsightsError, instagramInsights, parseInsights, threadsInsights, xInsights } from "@/lib/sns/insights";
import { hasInsightsScope, insightsEnabled, withInsightsScope } from "@/lib/sns/insights/scopes";

const account = { externalId: "123", accessToken: "tok" };
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const calledUrl = (f: ReturnType<typeof vi.fn>) => new URL(String((f.mock.calls[0] as unknown[])[0]));

describe("数字の権限", () => {
  it("SNS_INSIGHTS で有効にした SNS だけ、つなぐときに数字の権限を足す", () => {
    expect(withInsightsScope("threads", ["threads_basic"], "")).toEqual(["threads_basic"]);
    expect(withInsightsScope("threads", ["threads_basic"], "threads, instagram")).toEqual(["threads_basic", "threads_manage_insights"]);
    expect(withInsightsScope("instagram", ["instagram_business_basic"], "threads")).toEqual(["instagram_business_basic"]);
    expect(withInsightsScope("facebook", ["pages_show_list"], "facebook")).toEqual(["pages_show_list", "read_insights"]);
    expect(insightsEnabled("x", "threads,x")).toBe(true);
    expect(hasInsightsScope("threads", ["threads_basic", "threads_manage_insights"])).toBe(true);
    expect(hasInsightsScope("threads", ["threads_basic"])).toBe(false);
    expect(hasInsightsScope("note", ["anything"])).toBe(false);
  });
});

describe("返事の読み方", () => {
  it("values の最後・total_value を読み、名前をそろえ、反応の種類ごとの数は合計する。知らない名前・数でないものは捨てる", () => {
    expect(
      parseInsights(
        [
          { name: "views", values: [{ value: 3 }, { value: 120 }] },
          { name: "followers_count", total_value: { value: 48 } },
          { name: "post_reactions_by_type_total", values: [{ value: { like: 5, love: 2 } }] },
          { name: "unknown", values: [{ value: 9 }] },
          { name: "likes", values: [{ value: "x" }] },
        ],
        { views: "views", followers_count: "followers", post_reactions_by_type_total: "likes", likes: "likes" },
      ),
    ).toEqual({ views: 120, followers: 48, likes: 7 });
  });
});

describe("SNS ごと", () => {
  it("Threads: 投稿の insights とアカウントのフォロワー数", async () => {
    const f = reply({ data: [{ name: "views", values: [{ value: 300 }] }, { name: "likes", values: [{ value: 12 }] }] });
    expect(await threadsInsights.post(account, "m1", f as typeof fetch)).toEqual({ views: 300, likes: 12 });
    const u = calledUrl(f);
    expect(u.pathname).toBe("/v1.0/m1/insights");
    expect(u.searchParams.get("metric")).toContain("views");
    const g = reply({ data: [{ name: "followers_count", total_value: { value: 48 } }] });
    expect(await threadsInsights.account(account, g as typeof fetch)).toEqual({ followers: 48 });
    expect(calledUrl(g).pathname).toBe("/v1.0/123/threads_insights");
  });

  it("Instagram: 投稿の insights（comments は replies、saved は saves）と followers_count", async () => {
    const f = reply({ data: [{ name: "views", values: [{ value: 90 }] }, { name: "comments", values: [{ value: 2 }] }, { name: "saved", values: [{ value: 1 }] }] });
    expect(await instagramInsights.post(account, "ig1", f as typeof fetch)).toEqual({ views: 90, replies: 2, saves: 1 });
    expect(calledUrl(f).searchParams.get("metric")).not.toContain("impressions");
    expect(await instagramInsights.account(account, reply({ followers_count: 210 }) as typeof fetch)).toEqual({ followers: 210 });
  });

  it("Facebook: post_media_view などを views などにし、appsecret_proof を付ける", async () => {
    const fb = facebookInsights(() => "secret");
    const f = reply({ data: [{ name: "post_media_view", values: [{ value: 400 }] }, { name: "post_clicks", values: [{ value: 7 }] }] });
    expect(await fb.post(account, "p_1", f as typeof fetch)).toEqual({ views: 400, clicks: 7 });
    expect(calledUrl(f).searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
    expect(await fb.account(account, reply({ followers_count: 33 }) as typeof fetch)).toEqual({ followers: 33 });
  });

  it("X: public_metrics の impression_count などを views などにし、トークンはヘッダーで送る。フォロワーは users/me", async () => {
    const f = reply({ data: { id: "1", public_metrics: { impression_count: 500, like_count: 9, reply_count: 1, retweet_count: 2, quote_count: 0, bookmark_count: 3 } } });
    expect(await xInsights.post(account, "1", f as typeof fetch)).toEqual({ views: 500, likes: 9, replies: 1, reposts: 2, quotes: 0, saves: 3 });
    const u = calledUrl(f);
    expect(u.pathname).toBe("/2/tweets/1");
    expect(u.searchParams.get("tweet.fields")).toBe("public_metrics");
    expect(u.toString()).not.toContain("tok");
    expect((f.mock.calls[0] as unknown as [URL, RequestInit])[1].headers).toEqual({ Authorization: "Bearer tok" });
    const g = reply({ data: { id: "123", public_metrics: { followers_count: 77, following_count: 5 } } });
    expect(await xInsights.account(account, g as typeof fetch)).toEqual({ followers: 77 });
    expect(calledUrl(g).pathname).toBe("/2/users/me");
  });

  it("X: 消された投稿（200 で data なし）は見つからないエラー、401・403 は permission の印つき", async () => {
    const e = await xInsights.post(account, "1", reply({ errors: [{ detail: "Could not find tweet" }] }) as typeof fetch).catch((x) => x);
    expect(e).toMatchObject({ status: 404, permission: false });
    const e2 = await xInsights.post(account, "1", reply({ title: "Unauthorized" }, 401) as typeof fetch).catch((x) => x);
    expect(e2).toMatchObject({ status: 401, permission: true });
    const e3 = await xInsights.post(account, "1", reply({ title: "Too Many Requests" }, 429) as typeof fetch).catch((x) => x);
    expect(e3).toMatchObject({ status: 429, permission: false });
  });

  it("権限がないと言われたら permission の印つきのエラー", async () => {
    const e = await threadsInsights.post(account, "m1", reply({ error: { message: "(#10) permission", code: 10 } }, 400) as typeof fetch).catch((x) => x);
    expect(e).toBeInstanceOf(InsightsError);
    expect(e.permission).toBe(true);
    const e2 = await threadsInsights.post(account, "m1", reply({ error: { message: "oops", code: 1 } }, 500) as typeof fetch).catch((x) => x);
    expect(e2.permission).toBe(false);
  });
});
