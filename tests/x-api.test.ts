// X API の呼び出しとエラーの分け方。fetch は偽物に差し替え、本物の X には送らない
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createXAdapter, toXPublishError } from "@/lib/sns/adapters/x";
import { authorizeUrl, createPost, exchangeCode, fetchMe, refreshTokens, XApiError } from "@/lib/sns/x/api";

const config = { clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://localhost:3100/sns/x/callback" };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("認可画面の URL", () => {
  it("PKCE（S256）の challenge と、必要なスコープを付ける", () => {
    const url = new URL(authorizeUrl(config, "state-1", "verifier-1"));
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update("verifier-1").digest("base64url"));
    expect(url.searchParams.get("scope")).toBe("tweet.read tweet.write users.read offline.access media.write");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });
});

describe("トークン", () => {
  it("認可コードの交換は Basic 認証で、verifier を送る", async () => {
    const fetch = mockFetch(200, { access_token: "a1", refresh_token: "r1", expires_in: 7200, scope: "tweet.read tweet.write users.read offline.access" });
    const now = new Date("2026-10-11T00:00:00Z");
    const tokens = await exchangeCode(config, "code-1", "verifier-1", now);
    expect(tokens).toEqual({
      accessToken: "a1",
      refreshToken: "r1",
      expiresAt: new Date("2026-10-11T02:00:00Z"),
      scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    });
    const [input, init] = fetch.mock.calls[0];
    expect(String(input)).toBe("https://api.x.com/2/oauth2/token");
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    const body = new URLSearchParams(String(init!.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier-1");
  });

  it("取り直しはリフレッシュトークンを送り、新しいリフレッシュトークンを受け取る", async () => {
    const fetch = mockFetch(200, { access_token: "a2", refresh_token: "r2", expires_in: 7200 });
    const tokens = await refreshTokens(config, "r1");
    expect(tokens.refreshToken).toBe("r2");
    const body = new URLSearchParams(String(fetch.mock.calls[0][1]!.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r1");
  });

  it("使い終わったリフレッシュトークンは invalid_grant になり、接続切れとして扱う", async () => {
    mockFetch(400, { error: "invalid_request", error_description: "Value passed for the token was invalid." });
    const adapter = createXAdapter(() => config);
    await expect(adapter.refreshWithRefreshToken!("old", new Date())).rejects.toMatchObject({ kind: "permanent" });
    mockFetch(400, { error: "invalid_grant", error_description: "expired" });
    await expect(adapter.refreshWithRefreshToken!("old", new Date())).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("投稿とユーザー", () => {
  it("POST /2/tweets に本文を送り、投稿の ID と URL を返す", async () => {
    const fetch = mockFetch(201, { data: { id: "123", text: "hi" } });
    const result = await createXAdapter(() => config).publishText({ externalId: "u1", accessToken: "a1" }, "hi");
    expect(result).toEqual({ externalPostId: "123", url: "https://x.com/i/web/status/123" });
    const [input, init] = fetch.mock.calls[0];
    expect(String(input)).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(String(init!.body))).toEqual({ text: "hi" });
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer a1");
  });

  it("users/me から ID とユーザー名を読む", async () => {
    mockFetch(200, { data: { id: "42", username: "yabumi", name: "矢書" } });
    expect(await fetchMe("a1")).toEqual({ id: "42", username: "yabumi", name: "矢書" });
  });

  it("エラーの応答から、メッセージと種類を取り出す", async () => {
    mockFetch(429, { title: "UsageCapExceeded", detail: "Usage cap exceeded", type: "https://api.x.com/2/problems/usage-capped" });
    await expect(createPost("a1", "hi")).rejects.toMatchObject({ status: 429, message: "Usage cap exceeded" });
  });
});

describe("エラーの分け方", () => {
  it("401 は接続切れ", () => {
    expect(toXPublishError(new XApiError("Unauthorized", 401), "publish").kind).toBe("auth");
  });

  it("回数の上限・クレジット切れは、自動でやり直さず要確認（permanent）", () => {
    expect(toXPublishError(new XApiError("Too Many Requests", 429), "publish").kind).toBe("permanent");
    expect(toXPublishError(new XApiError("Payment Required", 402), "publish").kind).toBe("permanent");
    expect(toXPublishError(new XApiError("x", 403, "CreditsDepleted"), "publish").kind).toBe("permanent");
    expect(toXPublishError(new XApiError("x", 429), "publish").userMessage).toContain("手で投稿");
  });

  it("投稿の途中の X 側の障害・通信エラーは、投稿されたかわからない（unknown）", () => {
    expect(toXPublishError(new XApiError("Service Unavailable", 503), "publish").kind).toBe("unknown");
    expect(toXPublishError(new TypeError("fetch failed"), "publish").kind).toBe("unknown");
  });

  it("取り直しなど投稿の前の障害は、やり直す（retryable）", () => {
    expect(toXPublishError(new XApiError("Service Unavailable", 503), "prepare").kind).toBe("retryable");
    expect(toXPublishError(new TypeError("fetch failed"), "prepare").kind).toBe("retryable");
  });

  it("同じ文面の投稿は、わかりやすい説明にする", () => {
    const e = toXPublishError(new XApiError("You are not allowed to create a Tweet with duplicate content.", 403), "publish");
    expect(e.kind).toBe("permanent");
    expect(e.userMessage).toContain("同じ文面");
  });
});

describe("費用", () => {
  it("URL の有無で単価が変わる", () => {
    const adapter = createXAdapter(() => config);
    expect(adapter.publishCost!("こんにちは")).toEqual({ operation: "post", costUsd: 0.015 });
    expect(adapter.publishCost!("https://yabumi.app")).toEqual({ operation: "post_with_url", costUsd: 0.2 });
  });
});
