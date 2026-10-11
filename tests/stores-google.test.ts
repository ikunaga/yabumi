// Google Play の一括レポートと、App Store のストアのページの閲覧数のレポート（docs/architecture.md の 4.22、段取り ⑤）。本物は呼ばない
import { generateKeyPairSync, verify } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { ensureOngoingRequest, listDailyInstances, readInstance } from "@/lib/stores/app-store-analytics";
import { StoreApiError } from "@/lib/stores/app-store";
import {
  createServiceAccount,
  decodeCsv,
  impersonate,
  listObjects,
  managerAccessToken,
  managerKeyFromEnv,
  newAccountId,
  packageFromUrl,
  parseCsv,
  summarizePlay,
} from "@/lib/stores/google";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const managerKey = { client_email: "manager@yabumi-123.iam.gserviceaccount.com", private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), project_id: "yabumi-123" };
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const asc = { issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "2X9R4HXF34", privateKey: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), vendorNumber: "85123456" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
type Call = [string | URL | Request, RequestInit | undefined];

describe("Google Cloud", () => {
  it("管理用の鍵を環境変数から読む（形が違えば null）", () => {
    expect(managerKeyFromEnv(JSON.stringify(managerKey))).toMatchObject({ project_id: "yabumi-123" });
    expect(managerKeyFromEnv("{")).toBeNull();
    expect(managerKeyFromEnv(JSON.stringify({ client_email: "x" }))).toBeNull();
    expect(managerKeyFromEnv(undefined)).toBeNull();
  });

  it("管理用のトークン: RS256 で署名した JWT を送る", async () => {
    const f = vi.fn<(...a: Call) => Promise<Response>>(async () => json({ access_token: "mgr" }));
    expect(await managerAccessToken(managerKey, f as unknown as typeof fetch)).toBe("mgr");
    const body = f.mock.calls[0][1]!.body as URLSearchParams;
    const [h, p, s] = body.get("assertion")!.split(".");
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ iss: managerKey.client_email, aud: "https://oauth2.googleapis.com/token" });
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), rsa.publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("利用者ごとのアカウントを作り、なりかわって 10 分の読み取りのトークンを作る", async () => {
    expect(newAccountId()).toMatch(/^yabumi-[a-z0-9]{14}$/);
    const f = vi.fn<(...a: Call) => Promise<Response>>(async () => json({ email: "yabumi-abc@yabumi-123.iam.gserviceaccount.com" }));
    expect(await createServiceAccount(managerKey, "mgr", "yabumi-abc", "yabumi x", f as unknown as typeof fetch)).toBe("yabumi-abc@yabumi-123.iam.gserviceaccount.com");
    expect(String(f.mock.calls[0][0])).toBe("https://iam.googleapis.com/v1/projects/yabumi-123/serviceAccounts");
    const g = vi.fn<(...a: Call) => Promise<Response>>(async () => json({ accessToken: "short" }));
    expect(await impersonate("mgr", "a@b.iam.gserviceaccount.com", g as unknown as typeof fetch)).toBe("short");
    expect(JSON.parse(String(g.mock.calls[0][1]!.body))).toEqual({ scope: ["https://www.googleapis.com/auth/devstorage.read_only"], lifetime: "600s" });
  });

  it("バケットを読めないときは、招待・権限・置き場所のどれを確かめるかを出す", async () => {
    const e403 = await listObjects("t", "pubsite_prod_rev_1", "stats/", (async () => json({}, 403)) as typeof fetch).catch((x) => x);
    expect(e403).toBeInstanceOf(StoreApiError);
    expect(e403.userMessage).toMatch(/招待/);
    const e404 = await listObjects("t", "pubsite_prod_rev_1", "stats/", (async () => json({}, 404)) as typeof fetch).catch((x) => x);
    expect(e404.userMessage).toMatch(/置き場所/);
  });

  it("UTF-16 の CSV を読み、日ごとのインストールとストアのページの訪問者（国ごとを合計）にまとめる", () => {
    const installs = "Date,Package Name,Daily Device Installs,Daily User Installs,Daily User Uninstalls\n2026-10-01,com.ex.app,9,7,1\n2026-10-02,com.ex.app,4,3,0\n";
    const perf = 'Date,Package name,Country/region,Store listing acquisitions,Store listing visitors,"Store listing conversion rate"\n2026-10-01,com.ex.app,JP,5,40,"12.5%"\n2026-10-01,com.ex.app,US,1,"1,200",1%\n';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(installs, "utf16le")]);
    const days = summarizePlay(parseCsv(decodeCsv(utf16)), parseCsv(decodeCsv(Buffer.from(perf))));
    expect(days).toEqual({
      "2026-10-01": { downloads: 7, uninstalls: 1, page_views: 1240, store_acquisitions: 6 },
      "2026-10-02": { downloads: 3, uninstalls: 0, page_views: 0, store_acquisitions: 0 },
    });
    expect(packageFromUrl("https://play.google.com/store/apps/details?id=com.ex.app&hl=ja")).toBe("com.ex.app");
  });
});

describe("App Store のストアのページの閲覧数", () => {
  it("続けて作られる依頼があれば使い、なければ作る。Admin でないキーは断られる", async () => {
    const existing = vi.fn<(...a: Call) => Promise<Response>>(async () => json({ data: [{ id: "req-1", attributes: { stoppedDueToInactivity: false } }] }));
    expect(await ensureOngoingRequest(asc, "123456789", existing as unknown as typeof fetch)).toBe("req-1");
    const replies = [json({ data: [] }), json({ data: { id: "req-2" } }, 201)];
    const create = vi.fn<(...a: Call) => Promise<Response>>(async () => replies.shift()!);
    expect(await ensureOngoingRequest(asc, "123456789", create as unknown as typeof fetch)).toBe("req-2");
    expect(JSON.parse(String(create.mock.calls[1][1]!.body)).data.relationships.app.data.id).toBe("123456789");
    const e = await ensureOngoingRequest(asc, "123456789", (async () => json({}, 403)) as typeof fetch).catch((x) => x);
    expect(e.userMessage).toMatch(/Admin/);
  });

  it("Standard のレポートの、まだ読んでいない日ごとの回を古い順に。回のファイルから Page view と Impression を日ごとに合計", async () => {
    const replies = [
      json({ data: [{ id: "r-detailed", attributes: { name: "App Store Discovery and Engagement Detailed" } }, { id: "r-std", attributes: { name: "App Store Discovery and Engagement Standard" } }] }),
      json({ data: [{ id: "i2", attributes: { processingDate: "2026-10-09" } }, { id: "i1", attributes: { processingDate: "2026-10-08" } }, { id: "i0", attributes: { processingDate: "2026-10-01" } }] }),
    ];
    const f = vi.fn<(...a: Call) => Promise<Response>>(async () => replies.shift()!);
    expect(await listDailyInstances(asc, "req-1", "2026-10-05", f as unknown as typeof fetch)).toEqual([
      { id: "i1", processingDate: "2026-10-08" },
      { id: "i2", processingDate: "2026-10-09" },
    ]);
    expect(String(f.mock.calls[1][0])).toContain("/v1/analyticsReports/r-std/instances");

    const tsv = ["Date\tApp Name\tEvent\tPage Type\tCounts\tUnique Counts", "2026-10-07\tk\tPage view\tProduct page\t30\t20", "2026-10-07\tk\tPage view\tProduct page\t5\t4", "2026-10-07\tk\tImpression\tSearch\t400\t300", "2026-10-06\tk\tTap\tSearch\t9\t9"].join("\n");
    const seg = [json({ data: [{ id: "s1", attributes: { url: "https://apple.example/seg1.gz" } }] }), new Response(gzipSync(Buffer.from(tsv)))];
    const g = vi.fn<(...a: Call) => Promise<Response>>(async () => seg.shift()!);
    expect(await readInstance(asc, "i1", g as unknown as typeof fetch)).toEqual({
      "2026-10-07": { page_views: 35, impressions: 400 },
      "2026-10-06": { page_views: 0, impressions: 0 },
    });
  });
});
