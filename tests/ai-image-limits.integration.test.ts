// AI の画像の上限（docs/security/2026-11-03_セキュリティ確認.md の M1・L6）: 登録して 7 日までは月 3 枚、登録 7 日以内の人たち全体で全体の枠の 3 分の 1、
// 試みは 1 人 1 日 20 回まで（作れなかった回も数える）。決まりは DB の関数の中。画像の AI は偽物（本物は呼ばない）。使い捨ての利用者だけを使う
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ImageBlockedError, type GenerateImage } from "@/lib/ai/gemini-image";
import { PHOTO_LIMITS } from "@/lib/ai/photo";
import { acknowledgePhotoNotice, jstMonthDay, photoStatus, runPhotoGeneration } from "@/lib/ai/photo-gen";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();
const MODEL = "gemini-nano-banana-2.1";
const OLD = new Date(Date.now() + 8 * 86_400_000);
const users: { client: TestClient; userId: string; projectId: string }[] = [];

const fakeImage: GenerateImage = async () => ({ bytes: testJpeg({ width: 928, height: 1152 }), mimeType: "image/jpeg", inputTokens: 120 });

async function newUser() {
  const { client, userId } = await signUpNewUser();
  const projectId = (await client.from("projects").insert({ name: "画像の上限" }).select("id").single()).data!.id;
  await acknowledgePhotoNotice(admin, userId);
  const u = { client, userId, projectId };
  users.push(u);
  return u;
}

function reserve(u: { userId: string; projectId: string }, images: number, asOf?: Date) {
  return admin.rpc("reserve_ai_images", {
    p_owner_id: u.userId,
    p_project_id: u.projectId,
    p_model: MODEL,
    p_images: images,
    p_cost_usd: 0.0346 * images,
    p_scope_owner: u.userId,
    ...(asOf ? { p_as_of: asOf.toISOString() } : {}),
  });
}

async function registeredAt(userId: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data.user!.created_at;
}

beforeAll(async () => {
  await newUser();
});

afterAll(async () => {
  const ids = users.map((u) => u.userId);
  await admin.from("ai_image_jobs").delete().in("owner_id", ids);
  for (const u of users) {
    for (const dir of [u.userId, `${u.userId}/gen`]) {
      const { data } = await admin.storage.from("post-media").list(dir, { limit: 1000 });
      const files = (data ?? []).filter((f) => f.id);
      if (files.length) await admin.storage.from("post-media").remove(files.map((f) => `${dir}/${f.name}`));
    }
    await deleteUser(u.userId);
  }
});

describe("登録して 7 日まで（新しい人）", () => {
  it("月 3 枚で止まり、いつ 20 枚に戻るかを知らせる", async () => {
    const u = await newUser();
    const back = jstMonthDay(new Date(new Date(await registeredAt(u.userId)).getTime() + 7 * 86_400_000).toISOString());
    const s = await photoStatus(admin, u.userId, MODEL, { scopeOwner: u.userId });
    expect(s).toMatchObject({ monthlyImages: PHOTO_LIMITS.newUserMonthlyImages, remainingImages: 3 });
    expect(jstMonthDay(s.newUntil!)).toBe(back);

    const first = await runPhotoGeneration(u.client, admin, { generate: fakeImage, model: MODEL, scopeOwner: u.userId }, { userId: u.userId, projectId: u.projectId, scene: "店先", style: "photo", size: "square", count: 2 });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.remainingImages).toBe(1);
    const over = await runPhotoGeneration(u.client, admin, { generate: fakeImage, model: MODEL, scopeOwner: u.userId }, { userId: u.userId, projectId: u.projectId, scene: "店先", style: "photo", size: "square", count: 2 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toBe(`登録して 7 日までは、AI の画像は月 3 枚までです。${back} から月 20 枚になります。テンプレートの画像と、手持ちの写真は使えます。`);
    expect((await reserve(u, 1)).data?.[0]?.status).toBe("ok");
    expect((await reserve(u, 1)).data?.[0]).toMatchObject({ status: "user_limit", user_monthly_limit: 3, user_month_images: 3 });
  });

  it("7 日を過ぎたら、ふだんの 20 枚（今月の分はそのまま数える）", async () => {
    const u = users[0];
    const s = await photoStatus(admin, u.userId, MODEL, { asOf: OLD, scopeOwner: u.userId });
    expect(s).toMatchObject({ monthlyImages: 20, newUntil: null });
    const results = [];
    for (let i = 0; i < 11; i++) results.push((await reserve(u, 2, OLD)).data?.[0]?.status);
    expect(results.filter((x) => x === "ok")).toHaveLength(10);
    expect(results.at(-1)).toBe("user_limit");
    await admin.from("ai_image_jobs").delete().eq("owner_id", u.userId);
  });

  it("同時に頼んでも 3 枚を超えない", async () => {
    const u = await newUser();
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve(u, 1)));
    for (const r of results) expect(r.error).toBeNull();
    expect(results.filter((r) => r.data?.[0]?.status === "ok")).toHaveLength(3);
    expect(results.filter((r) => r.data?.[0]?.status === "user_limit")).toHaveLength(3);
  });
});

describe("登録 7 日以内の人たち全体の枠（全体の 3 分の 1）", () => {
  it("新しいうちに使った分が 3 分の 1 に届いたら、新しい人は止まる。7 日を過ぎた人はふだんの枠で数える", async () => {
    const u = await newUser();
    const share = PHOTO_LIMITS.globalMonthlyUsd * PHOTO_LIMITS.newUsersGlobalShare;
    // 新しいうちに 3 分の 1 の手前まで使った（スコープはこの利用者だけ。共有 DB のほかの記録に左右されない）
    await admin.from("ai_image_jobs").insert({ owner_id: u.userId, project_id: u.projectId, model: MODEL, images: 0, cost_usd: share - 0.02, status: "done" });
    const r = (await reserve(u, 1)).data?.[0];
    expect(r?.status).toBe("new_users_limit");
    expect((await photoStatus(admin, u.userId, MODEL, { scopeOwner: u.userId })).newUsersFull).toBe(true);
    const run = await runPhotoGeneration(u.client, admin, { generate: fakeImage, model: MODEL, scopeOwner: u.userId }, { userId: u.userId, projectId: u.projectId, scene: "店先", style: "photo", size: "square", count: 1 });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.message).toContain("登録して 7 日までの方が使える今月の AI の画像の枠が、いっぱいになりました。");
    // 8 日目からは、新しい人の枠は当てない（全体の $6.66 の中なら作れる）
    expect((await reserve(u, 1, OLD)).data?.[0]?.status).toBe("ok");
    expect((await photoStatus(admin, u.userId, MODEL, { asOf: OLD, scopeOwner: u.userId })).newUsersFull).toBe(false);
  });
});

describe("試みの回数（1 人 1 日 20 回。作れなかった回も数える）", () => {
  it("安全の決まりで断られた回も数え、21 回目は画像の AI を呼ばない", async () => {
    const u = await newUser();
    const blocked = vi.fn<GenerateImage>(async () => {
      throw new ImageBlockedError("blocked");
    });
    for (let i = 0; i < PHOTO_LIMITS.dailyAttempts; i++) {
      const r = await runPhotoGeneration(u.client, admin, { generate: blocked, model: MODEL, scopeOwner: u.userId, asOf: OLD }, { userId: u.userId, projectId: u.projectId, scene: "店先", style: "photo", size: "square", count: 1 });
      expect(r.ok).toBe(false);
    }
    expect(blocked).toHaveBeenCalledTimes(20);
    const last = await runPhotoGeneration(u.client, admin, { generate: blocked, model: MODEL, scopeOwner: u.userId, asOf: OLD }, { userId: u.userId, projectId: u.projectId, scene: "店先", style: "photo", size: "square", count: 1 });
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.message).toContain("1 日 20 回まで試せます（作れなかった回も数えます）");
    expect(blocked).toHaveBeenCalledTimes(20);
    // 枚数（月の上限）には数えない
    expect((await photoStatus(admin, u.userId, MODEL, { asOf: OLD, scopeOwner: u.userId })).usedImages).toBe(0);
  });
});

describe("テスト用の引数と、呼べる人", () => {
  it("ログインした利用者からは、予約も数えるのも呼べない", async () => {
    const u = users[0];
    expect((await u.client.rpc("reserve_ai_images", { p_owner_id: u.userId, p_project_id: u.projectId, p_model: MODEL, p_images: 1, p_cost_usd: 0.03, p_as_of: OLD.toISOString() })).error).not.toBeNull();
    expect((await u.client.rpc("ai_image_quota", { p_owner_id: u.userId, p_as_of: OLD.toISOString() })).error).not.toBeNull();
  });

  it("画面から呼ぶ操作（photo-actions.ts）は、p_as_of・p_scope_owner を渡す経路を持たない", () => {
    const src = readFileSync("src/lib/ai/photo-actions.ts", "utf8");
    for (const word of ["asOf", "scopeOwner", "p_as_of", "p_scope_owner"]) expect(src).not.toContain(word);
  });
});
