// ストアと課金の取り込みの部品（docs/architecture.md の 4.22）。本物の App Store Connect・RevenueCat は呼ばない
import { generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { credentialKeysFromEnv, openCredential, sealCredential } from "@/lib/crypto/credential-cipher";
import { appleIdFromUrl, ascJwt, checkAscFormat, fetchDailySales, pacificDate, parseTsv, StoreApiError, summarizeSales } from "@/lib/stores/app-store";
import { checkRevenueCatFormat, fetchOverview } from "@/lib/stores/revenuecat";

afterEach(() => vi.unstubAllGlobals());

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const cred = { issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "2X9R4HXF34", privateKey: PEM, vendorNumber: "85123456" };

const HEAD = ["Provider", "SKU", "Title", "Product Type Identifier", "Units", "Developer Proceeds", "Currency of Proceeds", "Apple Identifier", "Parent Identifier"].join("\t");
const row = (sku: string, type: string, units: number, proceeds: number, currency: string, appleId: string, parent = "") =>
  ["APPLE", sku, "t", type, String(units), String(proceeds), currency, appleId, parent].join("\t");
const TSV = [
  HEAD,
  row("kakeibo", "1", 12, 0, "JPY", "123456789"),
  row("kakeibo", "1F", 3, 0, "USD", "123456789"),
  row("kakeibo", "3", 2, 0, "JPY", "123456789"),
  row("kakeibo", "7", 40, 0, "JPY", "123456789"),
  row("kakeibo.pro", "IA1", 2, 210, "JPY", "999", "kakeibo"),
  row("kakeibo.pro", "IA1", -1, 210, "JPY", "999", "kakeibo"),
  row("kakeibo.pro", "IAY", 1, 1.4, "USD", "998", "kakeibo"),
  row("other", "1", 50, 0, "JPY", "555"),
  row("other.pro", "IA1", 9, 100, "JPY", "556", "other"),
].join("\n");

describe("預かる鍵の暗号化", () => {
  const key = randomBytes(32);
  const keys = { current: key, old: [] };
  it("開けるのは同じ行・同じ取り込み元だけ", () => {
    const sealed = sealCredential('{"a":1}', "row1:revenuecat", keys);
    expect(sealed.startsWith("c1.")).toBe(true);
    expect(openCredential(sealed, "row1:revenuecat", keys)).toEqual({ plain: '{"a":1}', needsReseal: false });
    expect(() => openCredential(sealed, "row2:revenuecat", keys)).toThrow();
  });

  it("鍵を入れ替えたあとも、古い鍵で暗号化したものを開け、暗号化し直すよう知らせる。古い鍵がなければ開けない", () => {
    const sealed = sealCredential("secret", "r:app_store_connect", keys);
    const rotated = { current: randomBytes(32), old: [key] };
    expect(openCredential(sealed, "r:app_store_connect", rotated)).toEqual({ plain: "secret", needsReseal: true });
    expect(() => openCredential(sealed, "r:app_store_connect", { current: rotated.current, old: [] })).toThrow(/古い鍵/);
  });

  it("環境変数から読む（32 バイトでなければ断る）", () => {
    const b64 = randomBytes(32).toString("base64");
    expect(credentialKeysFromEnv({ current: b64, old: ` ${b64} ,` }).old).toHaveLength(1);
    expect(() => credentialKeysFromEnv({ current: "short" })).toThrow();
    expect(() => credentialKeysFromEnv({ current: undefined })).toThrow();
  });
});

describe("App Store Connect", () => {
  it("JWT は ES256 で署名し、kid・iss・aud・20 分以内の exp を入れる", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    const [h, p, sig] = ascJwt(cred, now).split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "2X9R4HXF34", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toMatchObject({ iss: cred.issuerId, aud: "appstoreconnect-v1" });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60);
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("入れ間違いを、呼ぶ前に知らせる", () => {
    expect(checkAscFormat(cred)).toBeNull();
    expect(checkAscFormat({ ...cred, issuerId: "abc" })).toMatch(/Issuer ID/);
    expect(checkAscFormat({ ...cred, keyId: "x" })).toMatch(/Key ID/);
    expect(checkAscFormat({ ...cred, vendorNumber: "abc" })).toMatch(/ベンダー番号/);
    expect(checkAscFormat({ ...cred, privateKey: "hello" })).toMatch(/秘密鍵/);
    expect(checkAscFormat({ ...cred, privateKey: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----" })).toMatch(/読めませんでした/);
  });

  it("このアプリ（Apple ID）の初回・再ダウンロード・更新・アプリ内課金と、通貨ごとの受け取りにまとめる", () => {
    const rows = parseTsv(TSV);
    expect(summarizeSales(rows, "123456789")).toEqual({
      downloads: 15,
      redownloads: 2,
      updates: 40,
      iap_units: 2,
      proceeds: { JPY: 210, USD: 1.4 },
    });
    expect(appleIdFromUrl("https://apps.apple.com/jp/app/kakeibo/id123456789?l=en")).toBe("123456789");
    expect(appleIdFromUrl(null)).toBeNull();
    expect(pacificDate(new Date("2026-10-11T03:00:00Z"), 1)).toBe("2026-10-09");
  });

  it("レポートは gzip を開いて読む。売上のない日（404）は null。401・403・400 は利用者向けの説明", async () => {
    const fetch = vi.fn(async () => new Response(gzipSync(Buffer.from(TSV)), { status: 200 }));
    const rows = await fetchDailySales(cred, "2026-10-09", fetch as typeof globalThis.fetch);
    expect(rows).toHaveLength(9);
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("filter[reportDate]")).toBe("2026-10-09");
    expect(url.searchParams.get("filter[vendorNumber]")).toBe("85123456");
    expect(await fetchDailySales(cred, "2026-10-09", (async () => new Response("{}", { status: 404 })) as typeof globalThis.fetch)).toBeNull();
    for (const [status, pattern] of [[401, /鍵が使えません/], [403, /Sales and Reports/], [400, /ベンダー番号/]] as const) {
      const e = await fetchDailySales(cred, "2026-10-09", (async () => new Response("{}", { status })) as typeof globalThis.fetch).catch((x) => x);
      expect(e).toBeInstanceOf(StoreApiError);
      expect(e.userMessage).toMatch(pattern);
    }
  });
});

describe("RevenueCat", () => {
  it("形を確かめ、概要の数字を名前ごとに読む（数でないものは捨てる）。401・403・404 は説明", async () => {
    expect(checkRevenueCatFormat({ projectId: "proj1ab2c3d4", secretKey: "sk_abcdefghijklmnop" })).toBeNull();
    expect(checkRevenueCatFormat({ projectId: "proj1ab2c3d4", secretKey: "appl_xxx" })).toMatch(/sk_/);
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ metrics: [{ id: "mrr", value: 1200 }, { id: "revenue", value: 5400 }, { id: "bad", value: "x" }, { id: "Bad Id!", value: 1 }] }), { status: 200 }),
    );
    const values = await fetchOverview({ projectId: "proj1", secretKey: "sk_abcdefghijklmnop" }, "JPY", fetch as typeof globalThis.fetch);
    expect(values).toEqual({ mrr: 1200, revenue: 5400 });
    expect(new URL(String((fetch.mock.calls[0] as unknown[])[0])).searchParams.get("currency")).toBe("JPY");
    for (const [status, pattern] of [[401, /シークレットキー/], [403, /Charts & Metrics/], [404, /プロジェクトの ID/]] as const) {
      const e = await fetchOverview({ projectId: "p", secretKey: "sk_x" }, "JPY", (async () => new Response("{}", { status })) as typeof globalThis.fetch).catch((x) => x);
      expect(e.userMessage).toMatch(pattern);
    }
  });
});
