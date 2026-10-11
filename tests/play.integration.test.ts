// Google Play の取り込みと、App Store のストアのページの閲覧数（docs/architecture.md の 4.22、段取り ⑤）。
// HTTP は偽物（URL で振り分ける）で、本物の Google・Apple は呼ばない。取り込みは必ずテストの利用者に絞る
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupOrphanServiceAccounts, importAppStoreViews, removePlay, runPlayAndViewsImports, startAppStoreViews, startPlayConnection, verifyPlay } from "@/lib/stores/play-store";
import { saveCredential } from "@/lib/stores/store";
import { anonClient, adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const keys = { current: randomBytes(32), old: [] as Buffer[] };
const managerKey = {
  client_email: "manager@yabumi-123.iam.gserviceaccount.com",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  project_id: "yabumi-123",
};
const ascKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const asc = { issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "2X9R4HXF34", privateKey: ascKey, vendorNumber: "85123456" };
const NOW = new Date();
const ym = `${NOW.getUTCFullYear()}${String(NOW.getUTCMonth() + 1).padStart(2, "0")}`;
const recent = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(NOW);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let saEmail = "";

// Google・Apple の偽物
const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "mgr" });
  if (url.endsWith("/serviceAccounts") && init?.method === "POST") {
    saEmail = `${JSON.parse(String(init.body)).accountId}@yabumi-123.iam.gserviceaccount.com`;
    return json({ email: saEmail });
  }
  if (url.includes("/serviceAccounts/") && init?.method === "DELETE") return json({});
  if (url.includes("/serviceAccounts?")) {
    return json({ accounts: [{ email: saEmail }, { email: "yabumi-orphan00000000@yabumi-123.iam.gserviceaccount.com" }, { email: managerKey.client_email }, { email: "other@yabumi-123.iam.gserviceaccount.com" }] });
  }
  if (url.includes(":generateAccessToken")) return json({ accessToken: "reader" });
  if (url.includes("/b/pubsite_prod_rev_bad/")) return json({}, 403);
  if (url.includes("/o?")) return json({ items: [{ name: `stats/installs/installs_com.ex.app_${ym}_overview.csv` }] });
  if (url.includes(encodeURIComponent(`stats/installs/installs_com.ex.app_${ym}_overview.csv`))) {
    return new Response(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`Date,Daily User Installs\n${recent(3)},6\n${recent(10)},2\n`, "utf16le")]));
  }
  if (url.includes(encodeURIComponent(`stats/store_performance/store_performance_com.ex.app_${ym}_country.csv`))) {
    return new Response(`Date,Country/region,Store listing visitors\n${recent(3)},JP,50\n${recent(3)},US,20\n`);
  }
  if (url.includes("storage.googleapis.com")) return new Response("", { status: 404 });
  // App Store
  if (url.includes("/analyticsReportRequests?") || url.includes("/analyticsReportRequests?filter")) return json({ data: [] });
  if (url.includes("/apps/123456789/analyticsReportRequests")) return json({ data: [] });
  if (url.endsWith("/v1/analyticsReportRequests") && init?.method === "POST") return json({ data: { id: "req-1" } }, 201);
  if (url.includes("/analyticsReportRequests/req-1/reports")) return json({ data: [{ id: "r-std", attributes: { name: "App Store Discovery and Engagement Standard" } }] });
  if (url.includes("/analyticsReports/r-std/instances")) return json({ data: [{ id: "i1", attributes: { processingDate: recent(2) } }] });
  if (url.includes("/analyticsReportInstances/i1/segments")) return json({ data: [{ id: "s1", attributes: { url: "https://apple.example/seg.gz" } }] });
  if (url === "https://apple.example/seg.gz") return new Response(gzipSync(Buffer.from(`Date\tEvent\tCounts\n${recent(3)}\tPage view\t25\n${recent(3)}\tImpression\t300\n`)));
  return json({ error: `unexpected ${url}` }, 500);
}) as unknown as typeof fetch;

const deps = { managerKey, fetch: fakeFetch, keys, now: () => NOW };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (
    await alice
      .from("projects")
      .insert({ name: "Play", app_store_url: "https://apps.apple.com/jp/app/id123456789", play_store_url: "https://play.google.com/store/apps/details?id=com.ex.app" })
      .select("id")
      .single()
  ).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("Google Play", () => {
  it("専用のアカウントを 1 つ作り（2 回押しても同じ）、利用者も anon も読めない", async () => {
    const a = await startPlayConnection(admin, aliceId, projectId, deps);
    const b = await startPlayConnection(admin, aliceId, projectId, deps);
    expect(a).toMatch(/^yabumi-[a-z0-9]{14}@yabumi-123\.iam\.gserviceaccount\.com$/);
    expect(b).toBe(a);
    expect((await alice.from("play_connections").select("*").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("play_connections").select("*").limit(1)).error?.code).toBe("42501");
    expect((await alice.from("app_store_report_requests").select("*").limit(1)).error?.code).toBe("42501");
  });

  it("招待されていないバケットは、理由を出して保存しない", async () => {
    await expect(verifyPlay(admin, aliceId, projectId, "pubsite_prod_rev_bad", "com.ex.app", deps)).rejects.toMatchObject({ userMessage: expect.stringMatching(/招待/) });
    const { data } = await admin.from("play_connections").select("bucket, status").eq("project_id", projectId).single();
    expect(data).toEqual({ bucket: null, status: "pending" });
  });

  it("読めたら保存してすぐ取り込む: 日ごとのインストールとストアのページの訪問者（国を合計）", async () => {
    expect(await verifyPlay(admin, aliceId, projectId, "pubsite_prod_rev_0123", "com.ex.app", deps)).toMatch(/読めました/);
    const { data } = await alice.from("store_daily").select("day, values").eq("project_id", projectId).eq("source", "google_play").order("day");
    expect(data).toEqual([
      { day: recent(10), values: { downloads: 2, uninstalls: 0, page_views: 0, store_acquisitions: 0 } },
      { day: recent(3), values: { downloads: 6, uninstalls: 0, page_views: 70, store_acquisitions: 0 } },
    ]);
    expect((await bob.from("store_daily").select("day").eq("project_id", projectId)).data).toEqual([]);
  });

  it("毎日のジョブ（利用者に絞る）で読み直しても数字は同じ（上書き）", async () => {
    const outcomes = await runPlayAndViewsImports(admin, { ...deps, ownerId: aliceId });
    expect(outcomes.find((o) => o.projectId === projectId)).toMatchObject({ result: "imported", days: 2 });
    const { count } = await admin.from("store_daily").select("day", { count: "exact", head: true }).eq("project_id", projectId).eq("source", "google_play");
    expect(count).toBe(2);
  });
});

describe("App Store のストアのページの閲覧数", () => {
  it("Admin のキーで依頼を作り（キーは保存しない）、預かっている Sales and Reports のキーで日ごとに読む", async () => {
    await saveCredential(admin, { ownerId: aliceId, projectId, provider: "app_store_connect", secret: asc, hint: "" }, { keys });
    await startAppStoreViews(admin, aliceId, projectId, { ...asc, keyId: "ADMINKEY01" }, deps);
    const { data: row } = await admin.from("app_store_report_requests").select("*").eq("project_id", projectId).single();
    expect(row).toMatchObject({ request_id: "req-1", app_apple_id: "123456789" });
    expect(JSON.stringify(row)).not.toContain("ADMINKEY01");
    const o = await importAppStoreViews(admin, row!, deps);
    expect(o).toMatchObject({ result: "imported", days: 1 });
    const { data } = await alice.from("store_daily").select("day, values").eq("project_id", projectId).eq("source", "app_store_views");
    expect(data).toEqual([{ day: recent(3), values: { page_views: 25, impressions: 300 } }]);
  });

  it("週ごとの合計: ダウンロードは App Store と Google Play、ページの閲覧は両方の合計", async () => {
    const { data } = await alice.rpc("store_weekly_totals", { p_project_id: projectId, p_today: today() });
    expect(data![0]).toMatchObject({ downloads_this_week: 6, page_views_this_week: 95 });
  });
});

describe("片付け", () => {
  it("記録のない矢書のアカウントだけを消す（記録のあるもの・管理用・ほかの名前は消さない）", async () => {
    vi.mocked(fakeFetch).mockClear();
    const removed = await cleanupOrphanServiceAccounts(admin, deps);
    expect(removed).toEqual(["yabumi-orphan00000000@yabumi-123.iam.gserviceaccount.com"]);
    const deletes = vi.mocked(fakeFetch).mock.calls.filter(([, i]) => i?.method === "DELETE").map(([u]) => decodeURIComponent(String(u)));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain("yabumi-orphan00000000");
  });
});

describe("外す", () => {
  it("Google Play を外すと、矢書の側のアカウントを消し（Google に頼む）、つなぎも消える。数字は残る", async () => {
    vi.mocked(fakeFetch).mockClear();
    await removePlay(admin, aliceId, projectId, deps);
    expect(vi.mocked(fakeFetch).mock.calls.some(([u, i]) => String(u).includes(encodeURIComponent(saEmail)) && i?.method === "DELETE")).toBe(true);
    expect((await admin.from("play_connections").select("project_id").eq("project_id", projectId)).data).toEqual([]);
    expect((await alice.from("store_daily").select("day").eq("project_id", projectId).eq("source", "google_play")).data).toHaveLength(2);
  });
});
