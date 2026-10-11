// Facebook ページの呼び出しと、送信の流れ・エラーの分け方。fetch は偽物に差し替え、本物の Facebook には送らない
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFacebookAdapter, toFacebookError } from "@/lib/sns/adapters/facebook";
import { authorizeUrl, FacebookApiError, listPages } from "@/lib/sns/facebook/api";

const config = { appId: "meta-app", appSecret: "meta-secret", configId: "cfg-1", redirectUri: "https://localhost:3100/sns/facebook/callback" };

type Call = { url: URL; method: string; body: URLSearchParams | null };

function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body ? new URLSearchParams(String(init.body)) : null });
      const r = responses.shift() ?? { status: 500, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const page = { externalId: "1000", accessToken: "page-token" };
const image = (n: number) => ({ url: `https://storage.example/${n}.jpg`, altText: "", load: async () => new Uint8Array() });
const adapter = () => createFacebookAdapter(() => "meta-secret");
const proof = createHmac("sha256", "meta-secret").update("page-token").digest("hex");

describe("認可とページの一覧", () => {
  it("認可画面は Facebook Login for Business の設定（config_id）で開く", () => {
    const url = new URL(authorizeUrl(config, "s1"));
    expect(url.pathname).toBe("/v24.0/dialog/oauth");
    expect(url.searchParams.get("config_id")).toBe("cfg-1");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("管理しているページを、次のページまでたどって読む。投稿を作れる役割がないものは canPost が false", async () => {
    const calls = mockFetch([
      {
        body: {
          data: [{ id: "1", name: "A", access_token: "ta", tasks: ["CREATE_CONTENT", "MANAGE"] }],
          paging: { next: "https://graph.facebook.com/v24.0/me/accounts?after=x" },
        },
      },
      { body: { data: [{ id: "2", name: "B", access_token: "tb", tasks: ["ANALYZE"] }] } },
    ]);
    expect(await listPages(config, "user-token")).toEqual([
      { id: "1", name: "A", accessToken: "ta", canPost: true },
      { id: "2", name: "B", accessToken: "tb", canPost: false },
    ]);
    expect(calls[0].url.searchParams.get("appsecret_proof")).toBe(createHmac("sha256", "meta-secret").update("user-token").digest("hex"));
  });
});

describe("送る", () => {
  it("文章だけ: /feed に本文。appsecret_proof を付ける", async () => {
    const calls = mockFetch([{ body: { id: "1000_1" } }, { body: { permalink_url: "https://www.facebook.com/1000/posts/1" } }]);
    expect(await adapter().publishText(page, "こんにちは")).toEqual({ externalPostId: "1000_1", url: "https://www.facebook.com/1000/posts/1" });
    expect(calls[0].url.pathname).toBe("/v24.0/1000/feed");
    expect(calls[0].body?.get("message")).toBe("こんにちは");
    expect(calls[0].url.searchParams.get("appsecret_proof")).toBe(proof);
  });

  it("画像 1 枚: /photos に URL と本文。投稿の ID（post_id）を使う", async () => {
    const calls = mockFetch([{ body: { id: "photo1", post_id: "1000_2" } }, { body: {} }]);
    expect((await adapter().publishText(page, "画像", [image(1)])).externalPostId).toBe("1000_2");
    expect(calls[0].url.pathname).toBe("/v24.0/1000/photos");
    expect(calls[0].body?.get("url")).toBe(image(1).url);
    expect(calls[0].body?.get("published")).toBe("true");
  });

  it("画像 2 枚以上: 公開せずに上げてから、attached_media で 1 つの投稿にする", async () => {
    const calls = mockFetch([{ body: { id: "p1" } }, { body: { id: "p2" } }, { body: { id: "1000_3" } }, { body: {} }]);
    expect((await adapter().publishText(page, "2 枚", [image(1), image(2)])).externalPostId).toBe("1000_3");
    expect(calls[0].body?.get("published")).toBe("false");
    expect(calls[2].url.pathname).toBe("/v24.0/1000/feed");
    expect(calls[2].body?.get("attached_media[0]")).toBe(JSON.stringify({ media_fbid: "p1" }));
    expect(calls[2].body?.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "p2" }));
  });

  it("取り消しは DELETE /{post-id}", async () => {
    const calls = mockFetch([{ body: { success: true } }]);
    await adapter().deletePost(page, "1000_1");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url.pathname).toBe("/v24.0/1000_1");
  });
});

describe("エラーの分け方", () => {
  it("190 は接続切れ、権限がないのは要確認、回数制限はやり直す", () => {
    expect(toFacebookError(new FacebookApiError("x", 400, 190), "publish").kind).toBe("auth");
    expect(toFacebookError(new FacebookApiError("x", 403, 200), "publish").kind).toBe("permanent");
    expect(toFacebookError(new FacebookApiError("x", 400, 32), "publish").kind).toBe("retryable");
  });

  it("投稿の途中の障害・通信切れは、投稿されたかわからない（unknown）。上げる途中ならやり直す", () => {
    expect(toFacebookError(new FacebookApiError("x", 500, 1, undefined, true), "publish").kind).toBe("unknown");
    expect(toFacebookError(new TypeError("fetch failed"), "publish").kind).toBe("unknown");
    expect(toFacebookError(new FacebookApiError("x", 500, 1, undefined, true), "prepare").kind).toBe("retryable");
  });
});
