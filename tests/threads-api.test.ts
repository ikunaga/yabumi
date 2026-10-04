import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeUrl,
  exchangeCode,
  exchangeForLongLived,
  fetchProfile,
  refreshLongLived,
  shouldRefresh,
  ThreadsApiError,
} from "@/lib/sns/threads/api";

const config = { appId: "123", appSecret: "shh", redirectUri: "https://localhost:3100/sns/threads/callback" };

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void input;
    void init;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("Threads の OAuth", () => {
  it("認可画面の URL に必要な値が入る", () => {
    const url = new URL(authorizeUrl(config, "st"));
    expect(url.origin).toBe("https://threads.com");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toContain("threads_basic");
  });

  it("認可コードを短期トークンに替える（末尾の #_ は外す）", async () => {
    const fetch = mockFetch({ access_token: "short", user_id: 987 });
    const r = await exchangeCode(config, "abc#_");
    expect(r).toEqual({ accessToken: "short", userId: "987" });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://graph.threads.com/oauth/access_token");
    const body = init?.body as URLSearchParams;
    expect(body.get("code")).toBe("abc");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("長期トークンに替え、期限を計算する", async () => {
    const fetch = mockFetch({ access_token: "long", token_type: "bearer", expires_in: 5184000 });
    const now = new Date("2026-10-03T00:00:00Z");
    const r = await exchangeForLongLived(config, "short", now);
    expect(r.accessToken).toBe("long");
    expect(r.expiresAt.toISOString()).toBe("2026-12-02T00:00:00.000Z");
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe("/access_token");
    expect(url.searchParams.get("grant_type")).toBe("th_exchange_token");
  });

  it("長期トークンを延長する", async () => {
    const fetch = mockFetch({ access_token: "long2", token_type: "bearer", expires_in: 100 });
    const r = await refreshLongLived("long", new Date(0));
    expect(r.expiresAt.getTime()).toBe(100_000);
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get("grant_type")).toBe("th_refresh_token");
  });

  it("プロフィールを読む", async () => {
    mockFetch({ id: "987", username: "masa", name: "Masa" });
    expect(await fetchProfile("long")).toEqual({ id: "987", username: "masa", name: "Masa" });
  });

  it("エラー応答は ThreadsApiError にする", async () => {
    mockFetch({ error: { message: "Invalid OAuth access token", code: 190 } }, 400);
    await expect(fetchProfile("bad")).rejects.toBeInstanceOf(ThreadsApiError);
  });

  it("期限まで 30 日を切ったら延長する", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(shouldRefresh(new Date("2026-12-02T00:00:00Z"), now)).toBe(false);
    expect(shouldRefresh(new Date("2026-10-20T00:00:00Z"), now)).toBe(true);
  });
});
