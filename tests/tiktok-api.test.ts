// TikTok の窓口（docs/design/tiktok.md の 1.）。本物の TikTok には送らず、fetch を差し替えて確かめる
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIKTOK_SCOPES, TikTokApiError, authorizeUrl, connectedProfile, exchangeCode, readTokens, refreshTokens, revokeToken } from "@/lib/sns/tiktok/api";

const config = { clientKey: "ck", clientSecret: "cs", redirectUri: "https://yabumi.app/sns/tiktok/callback" };
const now = new Date("2026-11-14T00:00:00Z");
const calls: { url: string; init: RequestInit }[] = [];
const respond = (body: unknown, status = 200) => vi.fn(async (url: string | URL, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("認可の URL", () => {
  it("スコープは 3 つだけ・state 必須・code で戻る", () => {
    const u = new URL(authorizeUrl(config, "st"));
    expect(u.origin + u.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.upload");
    expect(TIKTOK_SCOPES).toHaveLength(3);
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(u.searchParams.get("client_key")).toBe("ck");
  });
});

describe("トークン", () => {
  it("期限は決め打ちにせず、返ってきた expires_in・refresh_expires_in から決める（2 時間でも 24 時間でも）", () => {
    for (const [sec, refresh] of [[7200, 15552000], [86400, 31536000]]) {
      const t = readTokens({ access_token: "a", refresh_token: "r", expires_in: sec, refresh_expires_in: refresh, open_id: "o", scope: "user.info.basic,video.publish" }, now);
      expect(t.expiresAt.getTime() - now.getTime()).toBe(sec * 1000);
      expect(t.refreshExpiresAt!.getTime() - now.getTime()).toBe(refresh * 1000);
      expect(t.scopes).toEqual(["user.info.basic", "video.publish"]);
    }
  });
  it("形の違う答えは受け取らない", () => {
    expect(() => readTokens({ access_token: "a", expires_in: 7200 }, now)).toThrow(TikTokApiError);
    expect(() => readTokens({ access_token: "a", refresh_token: "r", expires_in: "x" }, now)).toThrow(TikTokApiError);
  });
  it("コードの交換は form で送り、client_secret はサーバーからだけ送る（URL に載せない）", async () => {
    vi.stubGlobal("fetch", respond({ access_token: "a", refresh_token: "r1", expires_in: 7200, open_id: "o", scope: "video.publish" }));
    const t = await exchangeCode(config, "code-1", now);
    expect(t.openId).toBe("o");
    expect(calls[0].url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(calls[0].url).not.toContain("cs");
    const body = new URLSearchParams(String(calls[0].init.body));
    expect(Object.fromEntries(body)).toMatchObject({ client_key: "ck", client_secret: "cs", code: "code-1", grant_type: "authorization_code", redirect_uri: config.redirectUri });
  });
  it("取り直すと新しいリフレッシュトークンが返る（入れ替える）", async () => {
    vi.stubGlobal("fetch", respond({ access_token: "a2", refresh_token: "r2", expires_in: 7200, open_id: "o" }));
    const t = await refreshTokens(config, "r1", now);
    expect(t.refreshToken).toBe("r2");
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toMatchObject({ grant_type: "refresh_token", refresh_token: "r1" });
  });
  it("トークンの窓口のエラー（error・error_description）と、ほかの窓口のエラー（error.code）を読む", async () => {
    vi.stubGlobal("fetch", respond({ error: "invalid_grant", error_description: "bad code" }, 400));
    await expect(exchangeCode(config, "x", now)).rejects.toMatchObject({ code: "invalid_grant", status: 400 });
    vi.stubGlobal("fetch", respond({ data: {}, error: { code: "access_token_invalid", message: "expired" } }, 401));
    await expect(revokeToken(config, "a")).rejects.toMatchObject({ code: "access_token_invalid" });
  });
  it("取り消しは空の本文でも成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    await expect(revokeToken(config, "a")).resolves.toBeUndefined();
  });
});

describe("つないだアカウントの名前", () => {
  const tokens = (scopes: string[]) => ({ accessToken: "a", refreshToken: "r", expiresAt: now, refreshExpiresAt: null, openId: "o", scopes });
  it("video.publish があれば creator_info のニックネームと @ の名前", async () => {
    vi.stubGlobal("fetch", respond({ data: { creator_nickname: "こむぎ", creator_username: "komugi" }, error: { code: "ok" } }));
    expect(await connectedProfile(tokens(["user.info.basic", "video.publish"]))).toEqual({ openId: "o", nickname: "こむぎ", username: "komugi" });
    expect(calls[0].url).toContain("/v2/post/publish/creator_info/query/");
  });
  it("video.publish がなければ、ユーザー情報の表示名だけ", async () => {
    vi.stubGlobal("fetch", respond({ data: { user: { open_id: "o", display_name: "こむぎ" } }, error: { code: "ok" } }));
    expect(await connectedProfile(tokens(["user.info.basic"]))).toEqual({ openId: "o", nickname: "こむぎ", username: "" });
    expect(calls[0].url).toContain("/v2/user/info/");
  });
});

describe("外すときの取り消し", () => {
  it("TikTok はアクセストークンを取り消す（取り消しの窓口が使えなければ failed）", async () => {
    const { revokeSnsAccess } = await import("@/lib/sns/revoke");
    const { encryptToken } = await import("@/lib/crypto/token-cipher");
    const key = Buffer.alloc(32, 7);
    const row = { access_token_encrypted: encryptToken("tok", "acc-1", key) };
    const fakeAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) } as never;
    const seen: string[] = [];
    expect(await revokeSnsAccess(fakeAdmin, "acc-1", "tiktok", { key, revokeTikTok: async (t) => void seen.push(t) })).toBe("revoked");
    expect(seen).toEqual(["tok"]);
    expect(await revokeSnsAccess(fakeAdmin, "acc-1", "tiktok", { key })).toBe("failed");
    expect(await revokeSnsAccess(fakeAdmin, "acc-1", "tiktok", { key, revokeTikTok: async () => { throw new Error("x"); } })).toBe("failed");
  });
});
