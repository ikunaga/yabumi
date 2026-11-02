// ストアと課金をつなぐ操作は、宣伝するものがアプリのプロジェクトだけ（決定 D34。2026-11-02 のセキュリティチェックの Low）。
// 画面を通さずにサーバーアクションを呼んでも、アプリでなければ断る。外す操作は断らない
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

let current: TestClient;
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("断る前に使わない");
  },
}));

const { saveAppStoreConnect, saveGooglePlay, saveRevenueCat, startAppStorePageViews, startGooglePlay } = await import("@/lib/stores/actions");

let userId: string;
let shopId: string;
let appId: string;
const NOT_APP = /アプリのときに使えます/;

beforeAll(async () => {
  ({ client: current, userId } = await signUpNewUser());
  shopId = (await current.from("projects").insert({ name: "パン屋", product_type: "shop" }).select("id").single()).data!.id;
  appId = (await current.from("projects").insert({ name: "家計簿アプリ" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(userId);
});

describe("アプリでないプロジェクト", () => {
  it("App Store・RevenueCat・Google Play・ストアのページの閲覧数のどれも、つなぐ前に断る", async () => {
    const form = new FormData();
    expect((await saveAppStoreConnect(shopId, {}, form)).error).toMatch(NOT_APP);
    expect((await saveRevenueCat(shopId, {}, form)).error).toMatch(NOT_APP);
    expect((await startGooglePlay(shopId)).error).toMatch(NOT_APP);
    expect((await saveGooglePlay(shopId, {}, form)).error).toMatch(NOT_APP);
    expect((await startAppStorePageViews(shopId, {}, form)).error).toMatch(NOT_APP);
  });
});

describe("アプリのプロジェクト", () => {
  it("種類では断らない（入力の形の確かめなど、その先に進む）", async () => {
    const form = new FormData();
    expect((await saveRevenueCat(appId, {}, form)).error).not.toMatch(NOT_APP);
    expect((await saveGooglePlay(appId, {}, form)).error).not.toMatch(NOT_APP);
  });
});
