// ストアと課金の取り込み（docs/architecture.md の 4.22）。HTTP は偽物で、本物の App Store Connect・RevenueCat は呼ばない。
// 取り込みのジョブは、必ずテストの利用者に絞って呼ぶ
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { keyMark } from "@/lib/crypto/credential-cipher";
import { importForCredential, openStoredCredential, removeCredential, runStoreImports, saveCredential } from "@/lib/stores/store";
import { anonClient, adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const keys = { current: randomBytes(32), old: [] as Buffer[] };
const PEM = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const asc = { issuerId: "57246542-96fe-1a63-e053-0824d011072a", keyId: "2X9R4HXF34", privateKey: PEM, vendorNumber: "85123456" };
const NOW = new Date("2026-10-11T03:00:00Z");
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(NOW);

const TSV = ["Product Type Identifier\tUnits\tDeveloper Proceeds\tCurrency of Proceeds\tApple Identifier\tSKU\tParent Identifier", "1\t4\t0\tJPY\t123456789\tk\t", "IA1\t1\t210\tJPY\t9\tk.pro\tk"].join("\n");

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "ストア", app_store_url: "https://apps.apple.com/jp/app/id123456789" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

async function credRow(provider: string) {
  const { data } = await admin.from("store_credentials").select("*").eq("project_id", projectId).eq("provider", provider).single();
  return data!;
}

describe("預かる鍵", () => {
  it("暗号化して保存し、利用者も anon も読めない・書けない。同じ取り込み元は入れ替わる", async () => {
    await saveCredential(admin, { ownerId: aliceId, projectId, provider: "app_store_connect", secret: asc, hint: "Key ID …HF34" }, { keys });
    const id2 = await saveCredential(admin, { ownerId: aliceId, projectId, provider: "app_store_connect", secret: asc, hint: "Key ID …HF34" }, { keys });
    const row = await credRow("app_store_connect");
    expect(row.id).toBe(id2);
    expect(row.secret_sealed).not.toContain("PRIVATE KEY");
    expect(row.secret_sealed).not.toContain(asc.issuerId);
    expect((await alice.from("store_credentials").select("*").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("store_credentials").select("*").limit(1)).error?.code).toBe("42501");
    expect((await alice.from("store_credentials").insert({ owner_id: aliceId, project_id: projectId, provider: "revenuecat", secret_sealed: "x" })).error?.code).toBe("42501");
  });

  it("鍵を入れ替えたら、古い鍵で開いて、新しい鍵で暗号化し直す", async () => {
    const row = await credRow("app_store_connect");
    const rotated = { current: randomBytes(32), old: [keys.current] };
    expect(await openStoredCredential(admin, row as typeof row & { provider: "app_store_connect" }, { keys: rotated })).toEqual(asc);
    const after = await credRow("app_store_connect");
    expect(after.secret_sealed.split(".")[1]).toBe(keyMark(rotated.current));
    // 戻しておく（後のテストは keys で開く）
    await openStoredCredential(admin, after as typeof after & { provider: "app_store_connect" }, { keys: { current: keys.current, old: [rotated.current] } });
  });
});

describe("取り込み", () => {
  it("App Store: 最初は 14 日分のうち 7 日を読み、日ごとの数字を残す。このアプリだけを数える", async () => {
    const fetch = vi.fn(async () => new Response(gzipSync(Buffer.from(TSV)), { status: 200 }));
    const o = await importForCredential(admin, await credRow("app_store_connect"), { keys, fetch: fetch as typeof globalThis.fetch, now: () => NOW });
    expect(o).toMatchObject({ result: "imported", days: 7 });
    expect(fetch).toHaveBeenCalledTimes(7);
    const { data } = await alice.from("store_daily").select("day, values").eq("project_id", projectId).eq("source", "app_store").order("day");
    expect(data).toHaveLength(7);
    expect(data![0].values).toMatchObject({ downloads: 4, iap_units: 1, proceeds: { JPY: 210 } });
    expect((await credRow("app_store_connect")).last_imported_day).toBe(data![6].day);
    // 他人は読めない
    expect((await bob.from("store_daily").select("day").eq("project_id", projectId)).data).toEqual([]);
  });

  it("続き: 残りを読み、昨日（太平洋時間）まで済んだら飛ばす", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    const o = await importForCredential(admin, await credRow("app_store_connect"), { keys, fetch: fetch as typeof globalThis.fetch, now: () => NOW });
    expect(o).toMatchObject({ result: "imported" });
    const again = await importForCredential(admin, await credRow("app_store_connect"), { keys, fetch: fetch as typeof globalThis.fetch, now: () => NOW });
    expect(again.result).toBe("skipped");
  });

  it("RevenueCat: 今日の概要を残し、週ごとの合計の関数で、直近 28 日の売上が出る", async () => {
    await saveCredential(admin, { ownerId: aliceId, projectId, provider: "revenuecat", secret: { projectId: "proj1", secretKey: "sk_abcdefghijklmnop" }, hint: "" }, { keys });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ metrics: [{ id: "revenue", value: 5400 }, { id: "mrr", value: 1200 }] }), { status: 200 }));
    const outcomes = await runStoreImports(admin, { keys, fetch: fetch as typeof globalThis.fetch, now: () => NOW, ownerId: aliceId });
    expect(outcomes.find((o) => o.provider === "revenuecat")).toMatchObject({ result: "imported" });
    const { data } = await alice.rpc("store_weekly_totals", { p_project_id: projectId, p_today: today() });
    expect(data![0]).toMatchObject({ revenue_latest: 5400, revenue_currency: "JPY" });
    expect((await anonClient().rpc("store_weekly_totals", { p_project_id: projectId, p_today: today() })).error?.code).toBe("42501");
  });

  it("鍵が使えなくなったら「要確認」にし、理由を残す", async () => {
    const row = await credRow("revenuecat");
    await admin.from("store_credentials").update({ last_imported_day: null }).eq("id", row.id);
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    const o = await importForCredential(admin, await credRow("revenuecat"), { keys, fetch: fetch as typeof globalThis.fetch, now: () => NOW });
    expect(o.result).toBe("failed");
    const after = await credRow("revenuecat");
    expect(after.status).toBe("error");
    expect(after.last_error).toMatch(/シークレットキー/);
  });

  it("外すと鍵が消え、取り込んだ数字は残る", async () => {
    await removeCredential(admin, aliceId, projectId, "revenuecat");
    expect((await admin.from("store_credentials").select("id").eq("project_id", projectId).eq("provider", "revenuecat")).data).toEqual([]);
    expect((await alice.from("store_daily").select("day").eq("project_id", projectId).eq("source", "revenuecat")).data).toHaveLength(1);
  });
});
