// X の人気の投稿を探す（4.52）: 言葉の整え方・リクエスト・応答の読み取り（偽物）・並べ方・費用・残りの回数の文
import { describe, expect, it } from "vitest";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";
import { parseXSearch, xBuzzScore, xSearchCostUsd, xSearchParams, xSearchQuotaText, xSearchWord, X_SEARCH_RESERVE_USD } from "@/lib/sns/x/search";

const tweet = (id: string, author: string, m: Partial<Record<"like_count" | "retweet_count" | "quote_count" | "reply_count", number>>, extra: Record<string, unknown> = {}) => ({
  id,
  text: `投稿 ${id}`,
  author_id: author,
  created_at: `2026-11-0${id.slice(-1)}T03:00:00.000Z`,
  public_metrics: { like_count: 0, retweet_count: 0, quote_count: 0, reply_count: 0, impression_count: 999, ...m },
  ...extra,
});
const user = (id: string, username: string) => ({ id, name: `名前 ${username}`, username, profile_image_url: `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg` });

describe("言葉とリクエスト", () => {
  it("演算子を作れる文字（: ( ) \" と先頭の -）を除き、80 字までにする", () => {
    expect(xSearchWord("  器 冬  ")).toBe("器 冬");
    expect(xSearchWord("器 from:someone -is:reply (a OR b) \"c\"")).toBe("器 from someone is reply a OR b c");
    expect(xSearchWord("--器")).toBe("器");
    expect(xSearchWord("#うつわ")).toBe("#うつわ");
    expect(xSearchWord("あ".repeat(100))).toHaveLength(80);
    expect(xSearchWord(" : - ")).toBeNull();
    expect(xSearchWord(3)).toBeNull();
  });

  it("日本語・リポストと返信を除く演算子を付け、relevancy で 10 件、書いた人も一緒に取る", () => {
    const p = xSearchParams("器 冬");
    expect(p.get("query")).toBe("器 冬 lang:ja -is:retweet -is:reply");
    expect(p.get("max_results")).toBe("10");
    expect(p.get("sort_order")).toBe("relevancy");
    expect(p.get("expansions")).toBe("author_id");
    expect(p.get("user.fields")).toBe("name,username,profile_image_url");
    expect(p.get("tweet.fields")).toContain("public_metrics");
  });
});

describe("応答の読み取りと並べ方", () => {
  it("いいね ＋ (リポスト ＋ 引用) × 2 ＋ 返信 の順に並べ、同じなら新しい順", () => {
    expect(xBuzzScore({ likes: 10, reposts: 3, quotes: 1, replies: 2 })).toBe(20);
    const r = parseXSearch({
      data: [
        tweet("101", "1", { like_count: 30 }),
        tweet("102", "2", { like_count: 10, retweet_count: 15 }),
        tweet("103", "1", { like_count: 20, reply_count: 10 }),
        tweet("105", "2", { like_count: 30 }),
      ],
      includes: { users: [user("1", "utsuwa"), user("2", "kissa_x")] },
      meta: { result_count: 4 },
    })!;
    expect(r.posts.map((p) => p.id)).toEqual(["102", "105", "103", "101"]);
    expect(r.postCount).toBe(4);
    expect(r.userCount).toBe(2);
    expect(r.posts[0]).toMatchObject({
      url: "https://x.com/kissa_x/status/102",
      likes: 10,
      reposts: 15,
      score: 40,
      author: { name: "名前 kissa_x", username: "kissa_x", profileUrl: "https://x.com/kissa_x", imageUrl: "https://pbs.twimg.com/profile_images/2/a_normal.jpg" },
    });
  });

  it("長い投稿は全文（note_tweet）、文字参照は戻す。書いた人の見つからない投稿・形の合わない投稿は出さない", () => {
    const r = parseXSearch({
      data: [
        tweet("101", "1", {}, { text: "短く…", note_tweet: { text: "長い全文 &amp; <b>" } }),
        tweet("102", "9", {}),
        { id: "x", text: "", author_id: "1" },
        tweet("103", "1", {}, { text: "a &lt; b &gt; c" }),
      ],
      includes: { users: [user("1", "utsuwa"), { id: "2", name: "n", username: "bad name!" }] },
    })!;
    expect(r.posts.map((p) => p.text)).toEqual(["a < b > c", "長い全文 & <b>"]);
    // 費用は、返ってきた数で数える
    expect(r.postCount).toBe(4);
    expect(r.userCount).toBe(2);
  });

  it("アイコンは X の画像のサーバーの https だけ", () => {
    const r = parseXSearch({ data: [tweet("101", "1", {})], includes: { users: [{ ...user("1", "a"), profile_image_url: "http://evil.example/a.jpg" }] } })!;
    expect(r.posts[0].author.imageUrl).toBeNull();
  });

  it("見つからなかった（data がない）ときは 0 件。形の違う応答は null", () => {
    expect(parseXSearch({ meta: { result_count: 0 } })).toEqual({ posts: [], postCount: 0, userCount: 0 });
    expect(parseXSearch(null)).toBeNull();
    expect(parseXSearch({ data: "x" })).toBeNull();
  });
});

describe("費用と残りの回数の文", () => {
  it("1 回の予約は投稿 10 件と書いた人 10 人の分（$0.15）。実際の額は返ってきた数から", () => {
    expect(X_PRICE_USD.x_search_read).toBe(0.005);
    expect(X_PRICE_USD.x_search_user_read).toBe(0.01);
    expect(X_SEARCH_RESERVE_USD).toBeCloseTo(0.15, 10);
    expect(xSearchCostUsd(10, 4)).toBe(0.09);
    expect(xSearchCostUsd(0, 0)).toBe(0);
  });

  it("いつ戻るかを書く", () => {
    expect(xSearchQuotaText({ remaining: 2, limit: 3, reason: "ok", resetsOn: null })).toBe("今月はあと 2 回探せます");
    expect(xSearchQuotaText({ remaining: 0, limit: 3, reason: "user_limit", resetsOn: "2026-12-01" })).toBe("今月の分は使い切りました（12/1 から 3 回）");
    expect(xSearchQuotaText({ remaining: 0, limit: 1, reason: "new_user_limit", resetsOn: "2026-11-12" })).toBe("登録して 7 日までは月 1 回です（11/12 から月 3 回）");
    expect(xSearchQuotaText({ remaining: 1, limit: 3, reason: "global_limit", resetsOn: "2026-12-01" })).toBe("yabumi 全体の今月の分は使い切りました（12/1 から）");
  });
});
