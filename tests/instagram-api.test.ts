// Instagram（Instagram Login）の呼び出しと、送信の流れ・エラーの分け方。fetch は偽物に差し替え、本物の Instagram には送らない
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstagramAdapter, INSTAGRAM_DELETE_UNSUPPORTED, toInstagramError } from "@/lib/sns/adapters/instagram";
import { authorizeUrl, exchangeCode, fetchProfile, InstagramApiError, refreshLongLived } from "@/lib/sns/instagram/api";
import { checkTarget, countHashtags, instagramRatioOk } from "@/lib/sns";

const config = { appId: "ig-app", appSecret: "ig-secret", redirectUri: "https://localhost:3100/sns/instagram/callback" };

type Call = { url: URL; method: string; body: URLSearchParams | null };

// 呼ばれた順に応答を返す偽物の fetch
function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body ? new URLSearchParams(String(init.body)) : null });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const image = (n: number) => ({ url: `https://storage.example/${n}.jpg?token=x`, altText: n === 1 ? "画面" : "", load: async () => new Uint8Array() });
const account = { externalId: "17841400000000000", accessToken: "ig-token" };
const fastAdapter = () => createInstagramAdapter({ sleep: async () => {}, pollIntervalMs: 0, maxPolls: 3 });

describe("認可とトークン", () => {
  it("認可画面の URL に、必要な権限だけを付ける", () => {
    const url = new URL(authorizeUrl(config, "state-1"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("認可コードの交換は、data で包まれた応答でもそのままの応答でも読める。末尾の #_ は取り除く", async () => {
    const calls = mockFetch([{ body: { data: [{ access_token: "short", user_id: 123, permissions: "x" }] } }, { body: { access_token: "short2", user_id: "456" } }]);
    expect(await exchangeCode(config, "code#_")).toEqual({ accessToken: "short", userId: "123" });
    expect(await exchangeCode(config, "code2")).toEqual({ accessToken: "short2", userId: "456" });
    expect(calls[0].url.toString()).toBe("https://api.instagram.com/oauth/access_token");
    expect(calls[0].body?.get("code")).toBe("code");
    expect(calls[0].body?.get("grant_type")).toBe("authorization_code");
  });

  it("長期トークンの延長は ig_refresh_token で、また 60 日になる", async () => {
    const calls = mockFetch([{ body: { access_token: "long-2", expires_in: 5184000 } }]);
    const now = new Date("2026-10-11T00:00:00Z");
    const t = await refreshLongLived("long-1", now);
    expect(t).toEqual({ accessToken: "long-2", expiresAt: new Date("2026-12-10T00:00:00Z") });
    expect(calls[0].url.searchParams.get("grant_type")).toBe("ig_refresh_token");
  });

  it("プロフィールから ID・ユーザー名・アカウントの種類を読む", async () => {
    mockFetch([{ body: { user_id: "17841", username: "yabumi", name: "矢書", account_type: "MEDIA_CREATOR" } }]);
    expect(await fetchProfile("t")).toEqual({ id: "17841", username: "yabumi", name: "矢書", accountType: "MEDIA_CREATOR" });
  });
});

describe("送る", () => {
  it("画像 1 枚: コンテナ（画像と本文）→ 準備を待つ → 公開 → URL", async () => {
    const calls = mockFetch([
      { body: { id: "c1" } },
      { body: { status_code: "IN_PROGRESS" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "m1" } },
      { body: { permalink: "https://www.instagram.com/p/abc/" } },
    ]);
    const result = await fastAdapter().publishText(account, "新しい版です", [image(1)]);
    expect(result).toEqual({ externalPostId: "m1", url: "https://www.instagram.com/p/abc/" });
    expect(calls[0].url.pathname).toBe(`/v24.0/${account.externalId}/media`);
    expect(calls[0].body?.get("image_url")).toBe(image(1).url);
    expect(calls[0].body?.get("caption")).toBe("新しい版です");
    expect(calls[0].body?.get("alt_text")).toBe("画面");
    expect(calls[3].url.pathname).toBe(`/v24.0/${account.externalId}/media_publish`);
    expect(calls[3].body?.get("creation_id")).toBe("c1");
  });

  it("画像 2 枚以上: 1 枚ずつのコンテナ → まとめたコンテナ（CAROUSEL）に本文を付けて公開", async () => {
    const calls = mockFetch([
      { body: { id: "i1" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "i2" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "car" } },
      { body: { status_code: "FINISHED" } },
      { body: { id: "m2" } },
      { body: {} },
    ]);
    const result = await fastAdapter().publishText(account, "2 枚", [image(1), image(2)]);
    expect(result).toEqual({ externalPostId: "m2", url: null });
    expect(calls[0].body?.get("is_carousel_item")).toBe("true");
    expect(calls[0].body?.get("caption")).toBeNull();
    expect(calls[4].body?.get("media_type")).toBe("CAROUSEL");
    expect(calls[4].body?.get("children")).toBe("i1,i2");
    expect(calls[4].body?.get("caption")).toBe("2 枚");
  });

  it("画像がなければ送らない", async () => {
    await expect(fastAdapter().publishText(account, "文だけ", [])).rejects.toMatchObject({ kind: "permanent" });
  });

  it("準備が終わらなければやり直し（公開していないので二重にならない）、ERROR なら要確認", async () => {
    mockFetch([{ body: { id: "c1" } }, { body: { status_code: "IN_PROGRESS" } }, { body: { status_code: "IN_PROGRESS" } }, { body: { status_code: "IN_PROGRESS" } }]);
    await expect(fastAdapter().publishText(account, "x", [image(1)])).rejects.toMatchObject({ kind: "retryable" });
    mockFetch([{ body: { id: "c1" } }, { body: { status_code: "ERROR", status: "aspect ratio" } }]);
    await expect(fastAdapter().publishText(account, "x", [image(1)])).rejects.toMatchObject({ kind: "permanent" });
  });

  it("取り消しはできない（Instagram Login では API で消せない）", async () => {
    await expect(fastAdapter().deletePost(account, "m1")).rejects.toMatchObject({ kind: "permanent", userMessage: INSTAGRAM_DELETE_UNSUPPORTED });
  });
});

describe("エラーの分け方", () => {
  it("190 は接続切れ、24 時間の上限は要確認、回数制限はやり直す", () => {
    expect(toInstagramError(new InstagramApiError("x", 400, 190), "prepare").kind).toBe("auth");
    expect(toInstagramError(new InstagramApiError("x", 400, 9, 2207042), "publish").kind).toBe("permanent");
    expect(toInstagramError(new InstagramApiError("x", 400, 4), "prepare").kind).toBe("retryable");
  });

  it("公開の途中の障害・通信切れは、投稿されたかわからない（unknown）", () => {
    expect(toInstagramError(new InstagramApiError("x", 500, 2, undefined, true), "publish").kind).toBe("unknown");
    expect(toInstagramError(new TypeError("fetch failed"), "publish").kind).toBe("unknown");
    expect(toInstagramError(new TypeError("fetch failed"), "prepare").kind).toBe("retryable");
  });
});

describe("Instagram の決まり（作成画面と保存の確かめ）", () => {
  it("縦横比は 4:5〜1.91:1", () => {
    expect(instagramRatioOk(1080, 1350)).toBe(true); // 4:5
    expect(instagramRatioOk(1080, 1080)).toBe(true);
    expect(instagramRatioOk(1910, 1000)).toBe(true);
    expect(instagramRatioOk(1170, 2532)).toBe(false); // スマホのスクリーンショット
    expect(instagramRatioOk(2000, 1000)).toBe(false);
  });

  it("ハッシュタグは 30 個まで。全角の ＃ も数える", () => {
    expect(countHashtags("#個人開発 #indiedev ＃アプリ")).toBe(3);
    expect(countHashtags("issue#12 は数えない")).toBe(0);
    const many = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(checkTarget("instagram", many, { images: 1, videos: 0, sizes: [{ width: 1080, height: 1080 }] }).issues).toContain("too_many_hashtags");
  });

  it("縦横比の合わない画像があれば、送れない", () => {
    const check = checkTarget("instagram", "本文", { images: 2, videos: 0, sizes: [{ width: 1080, height: 1080 }, { width: 1170, height: 2532 }] });
    expect(check.issues).toContain("bad_aspect_ratio");
    expect(checkTarget("threads", "本文", { images: 1, videos: 0, sizes: [{ width: 1170, height: 2532 }] }).issues).toEqual([]);
  });
});
