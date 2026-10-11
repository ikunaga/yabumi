// 短縮リンクの決まり（docs/architecture.md の 4.22、決定 D20）
import { describe, expect, it } from "vitest";
import { shortLinkRoute } from "@/lib/links/host";
import { isValidDestination } from "@/lib/links/store";
import { CODE_LENGTH, CODE_PATTERN, classifyRequest, findLinkableUrls, generateCode, shortLinkBase, substituteLinks, substitutesBodyLinks, withTrackingParams } from "@/lib/links/rules";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("コード", () => {
  it("決まった長さの英数字で、紛らわしい字（0・O・1・l・I）を使わない", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(CODE_PATTERN);
      expect(code).not.toMatch(/[0O1lI]/);
    }
  });
});

describe("押した人の見分け", () => {
  it("端末を見分ける", () => {
    expect(classifyRequest({ userAgent: IPHONE, purpose: null })).toEqual({ device: "ios", excluded: null });
    expect(classifyRequest({ userAgent: ANDROID, purpose: null })).toEqual({ device: "android", excluded: null });
    expect(classifyRequest({ userAgent: MAC, purpose: null })).toEqual({ device: "desktop", excluded: null });
  });

  it("SNS のプレビューのクローラー、User-Agent のないもの、先読みは数えない", () => {
    for (const ua of [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "meta-externalagent/1.1",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "curl/8.4.0",
      "",
    ]) {
      expect(classifyRequest({ userAgent: ua, purpose: null }).excluded).toBe("bot");
    }
    expect(classifyRequest({ userAgent: null, purpose: null }).excluded).toBe("bot");
    expect(classifyRequest({ userAgent: IPHONE, purpose: "prefetch;prerender" }).excluded).toBe("prefetch");
  });
});

describe("行き先に付ける印", () => {
  it("App Store は ct（30 字まで）と pt", () => {
    const u = new URL(withTrackingParams("https://apps.apple.com/jp/app/id123456789", { sns: "threads", code: "Ab3dE5fG", appStoreProviderToken: "118000" }));
    expect(u.searchParams.get("ct")).toBe("threads-Ab3dE5fG");
    expect(u.searchParams.get("pt")).toBe("118000");
    // すでに付いていれば上書きしない。pt がなければ付けない
    const v = new URL(withTrackingParams("https://apps.apple.com/app/id1?ct=mine", { sns: "x", code: "Ab3dE5fG" }));
    expect(v.searchParams.get("ct")).toBe("mine");
    expect(v.searchParams.has("pt")).toBe(false);
  });

  it("Google Play は referrer の中に UTM", () => {
    const u = new URL(withTrackingParams("https://play.google.com/store/apps/details?id=com.example.app", { sns: "x", code: "Ab3dE5fG" }));
    expect(u.searchParams.get("id")).toBe("com.example.app");
    expect(new URLSearchParams(u.searchParams.get("referrer")!).get("utm_source")).toBe("x");
    expect(new URLSearchParams(u.searchParams.get("referrer")!).get("utm_campaign")).toBe("Ab3dE5fG");
  });

  it("ほかのサイトは UTM（SNS のないリンクは link）。すでにあれば上書きしない", () => {
    const u = new URL(withTrackingParams("https://example.com/lp?a=1", { sns: null, code: "Ab3dE5fG" }));
    expect(u.searchParams.get("a")).toBe("1");
    expect(u.searchParams.get("utm_source")).toBe("link");
    expect(withTrackingParams("https://example.com/?utm_source=own", { sns: "x", code: "c" })).toBe("https://example.com/?utm_source=own");
  });
});

describe("本文の URL の置き換え", () => {
  it("https の URL を見つける（句読点・かっこは含めない）", () => {
    expect(findLinkableUrls("新しくしました！https://apps.apple.com/app/id1 。詳しくは（https://example.com/a）と http://old.example.com")).toEqual([
      "https://apps.apple.com/app/id1",
      "https://example.com/a",
    ]);
  });

  it("対応する短縮リンクに置き換え、ほかの URL と文はそのまま", () => {
    const map = new Map([["https://apps.apple.com/app/id1", "https://go.yabumi.app/Ab3dE5fG"]]);
    expect(substituteLinks("見てね https://apps.apple.com/app/id1. と https://example.com", map)).toBe("見てね https://go.yabumi.app/Ab3dE5fG. と https://example.com");
  });

  it("Instagram は本文の URL を押せないので置き換えない", () => {
    expect(substitutesBodyLinks("instagram")).toBe(false);
    expect(substitutesBodyLinks("x")).toBe(true);
    expect(substitutesBodyLinks("threads")).toBe(true);
  });
});

describe("短縮リンクのホストとパス", () => {
  const base = "https://go.yabumi.app";
  it("go.yabumi.app/<code> は /go/<code> に回す。/ だけなら矢書のトップへ", () => {
    const r = shortLinkRoute(new URL("https://go.yabumi.app/Ab3dE5fG?x=1"), base, "https://yabumi.app");
    expect(r).toMatchObject({ type: "rewrite" });
    expect((r as { url: URL }).url.pathname).toBe("/go/Ab3dE5fG");
    expect(shortLinkRoute(new URL("https://go.yabumi.app/"), base, "https://yabumi.app")).toEqual({ type: "redirect", url: new URL("https://yabumi.app") });
  });

  it("どのホストでも /go/ はそのまま通す（独自ドメインへの転送やログインの確認を飛ばす）。ほかは関わらない", () => {
    expect(shortLinkRoute(new URL("https://yabumi-xxxx.vercel.app/go/Ab3dE5fG"), base, "https://yabumi.app")).toEqual({ type: "pass" });
    expect(shortLinkRoute(new URL("https://yabumi.app/projects"), base, "https://yabumi.app")).toBeNull();
    expect(shortLinkRoute(new URL("https://yabumi.app/projects"), undefined, "https://yabumi.app")).toBeNull();
  });

  it("短縮リンクの URL の土台: SHORT_LINK_BASE_URL がなければ <APP_URL>/go", () => {
    expect(shortLinkBase({ shortLinkBaseUrl: "https://go.yabumi.app/", appUrl: "https://yabumi.app" })).toBe("https://go.yabumi.app");
    expect(shortLinkBase({ shortLinkBaseUrl: "", appUrl: "https://yabumi.app/" })).toBe("https://yabumi.app/go");
  });
});

describe("行き先に使えるもの（悪用への備え）", () => {
  it("https のふつうのサイトとストアだけ。IP アドレス・内部のホスト・矢書自身・ポート・認証情報つきは使えない", () => {
    expect(isValidDestination("https://apps.apple.com/jp/app/id1")).toBe(true);
    expect(isValidDestination("https://example.com/a?b=1")).toBe(true);
    for (const bad of [
      "http://example.com",
      "javascript:alert(1)",
      "https://203.0.113.5/login",
      "https://[::1]/",
      "https://localhost/",
      "https://intranet/",
      "https://printer.local/",
      "https://go.yabumi.app/Ab3dE5fG",
      "https://yabumi.app/login",
      "https://yabumi-xxxx.vercel.app/",
      "https://example.com:8443/",
      "https://user:pass@example.com/",
    ]) {
      expect(isValidDestination(bad), bad).toBe(false);
    }
  });
});
