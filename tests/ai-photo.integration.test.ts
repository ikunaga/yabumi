// AI で写真・絵をつくる（docs/architecture.md の 4.25 の ②、D35）: 予約つきの上限（1 人 月 20 枚・全体の費用）、
// 他人から読めないこと、AI の印、候補の置き場所。画像の AI は偽物に差し替える（本物は呼ばない）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ImageBlockedError, type GenerateImage } from "@/lib/ai/gemini-image";
import { PHOTO_LIMITS } from "@/lib/ai/photo";
import { AiRequestRejected, AiUnavailableError } from "@/lib/ai/provider-failure";
import { estimateImageCostUsd } from "@/lib/ai/pricing";
import { acknowledgePhotoNotice, ownRecentPhotoJob, photoStatus, refreshCandidateUrls, runPhotoGeneration } from "@/lib/ai/photo-gen";
import { readAiMark } from "@/lib/media/jpeg";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { downloadMedia, issueUpload, verifyUpload } from "@/lib/media/store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();
const MODEL = "gemini-nano-banana-2.1";

let alice: TestClient;
let bob: TestClient;
let carol: TestClient;
let aliceId: string;
let bobId: string;
let carolId: string;
let aliceProject: string;
let bobProject: string;
let carolProject: string;

// 登録して 8 日たったことにする時点（ふだんの上限 1 人 月 20 枚で確かめるテスト用。p_as_of。アプリからは渡さない）
const OLD = new Date(Date.now() + 8 * 86_400_000);

const fakeImage: GenerateImage = async () => ({ bytes: testJpeg({ width: 928, height: 1152 }), mimeType: "image/jpeg", inputTokens: 120 });

function run(client: TestClient, userId: string, projectId: string, generate: GenerateImage, extra: Partial<{ scene: string; count: number }> = {}) {
  return runPhotoGeneration(client, admin, { generate, model: MODEL, scopeOwner: userId, asOf: OLD }, { userId, projectId, scene: "朝の光が入るパン屋のカウンター", style: "photo", size: "portrait", count: 2, ...extra });
}

function reserve(userId: string, projectId: string, images: number) {
  return admin.rpc("reserve_ai_images", { p_owner_id: userId, p_project_id: projectId, p_model: MODEL, p_images: images, p_cost_usd: 0.0336 * images, p_scope_owner: userId, p_as_of: OLD.toISOString() });
}

async function removeStorage(owner: string) {
  for (const dir of [owner, `${owner}/gen`]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(dir, { limit: 1000 });
    const files = (data ?? []).filter((f) => f.id);
    if (files.length) await admin.storage.from(MEDIA_BUCKET).remove(files.map((f) => `${dir}/${f.name}`));
  }
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  ({ client: carol, userId: carolId } = await signUpNewUser());
  aliceProject = (await alice.from("projects").insert({ name: "まちのパン屋" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "ことばの教室" }).select("id").single()).data!.id;
  carolProject = (await carol.from("projects").insert({ name: "器の店" }).select("id").single()).data!.id;
});

afterAll(async () => {
  // 退会すると記録は紐づけを外して残る（全体の上限に数え続ける）ので、テストの記録は先に消す（共有 DB の全体の費用を増やさない）
  await admin.from("ai_image_jobs").delete().in("owner_id", [aliceId, bobId, carolId]);
  for (const id of [aliceId, bobId, carolId]) {
    await removeStorage(id);
    await deleteUser(id);
  }
});

describe("注意を読むまでは作れない", () => {
  it("読んだ記録がなければ予約もしない", async () => {
    const r = await run(alice, aliceId, aliceProject, fakeImage);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("注意");
    const { count } = await admin.from("ai_image_jobs").select("id", { count: "exact", head: true }).eq("owner_id", aliceId);
    expect(count).toBe(0);
    expect((await photoStatus(admin, aliceId, MODEL, { asOf: OLD, scopeOwner: aliceId })).acknowledged).toBe(false);
  });
});

describe("つくる", () => {
  let jobId: string;
  let paths: string[] = [];

  it("候補を <利用者>/gen/ に置き、できた枚数と費用で記録する", async () => {
    await acknowledgePhotoNotice(admin, aliceId);
    await acknowledgePhotoNotice(admin, aliceId);
    const prompts: string[] = [];
    const r = await run(alice, aliceId, aliceProject, async (a) => {
      prompts.push(`${a.aspectRatio}|${a.prompt}`);
      return fakeImage(a);
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    jobId = r.jobId;
    paths = r.candidates.map((c) => c.path);
    expect(r.candidates).toHaveLength(2);
    expect(r.remainingImages).toBe(PHOTO_LIMITS.userMonthlyImages - 2);
    expect(prompts[0]).toMatch(/^4:5\|/);
    expect(prompts[0]).toContain("朝の光が入るパン屋のカウンター");
    for (const c of r.candidates) {
      expect(c.path).toMatch(new RegExp(`^${aliceId}/gen/[0-9a-f-]{36}\\.jpg$`));
      expect(c.url).toContain("token=");
      expect([c.width, c.height]).toEqual([928, 1152]);
    }
    const { data: job } = await admin.from("ai_image_jobs").select("*").eq("id", jobId).single();
    expect(job).toMatchObject({ status: "done", images: 2, project_id: aliceProject, model: MODEL });
    expect(Number(job!.cost_usd)).toBeCloseTo(0.0672 + (240 * 1.5) / 1_000_000, 6);
    // 候補には記録（media_files）を作らない（1 日で片付けの対象になる）
    const { count } = await admin.from("media_files").select("id", { count: "exact", head: true }).in("storage_path", r.candidates.map((c) => c.path));
    expect(count).toBe(0);
  });

  it("1 枚だけ失敗したら、できた 1 枚だけ数える", async () => {
    let n = 0;
    const r = await run(alice, aliceId, aliceProject, async (a) => {
      if (n++ === 0) throw new Error("timeout");
      return fakeImage(a);
    });
    expect(r.ok && r.partial).toBe(true);
    expect((await photoStatus(admin, aliceId, MODEL, { asOf: OLD, scopeOwner: aliceId })).usedImages).toBe(3);
  });

  it("安全の決まりで断られたら、理由を出して数えない", async () => {
    const r = await run(alice, aliceId, aliceProject, async () => {
      throw new ImageBlockedError("blocked by safety");
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("安全の決まり");
      expect(r.remainingImages).toBe(PHOTO_LIMITS.userMonthlyImages - 3);
    }
    const s = await photoStatus(admin, aliceId, MODEL, { asOf: OLD, scopeOwner: aliceId });
    expect(s.usedImages).toBe(3);
  });

  it("支払い・鍵の問題（402・403・401）なら「いま使えない（運営者に知らせた）」と出し、「時間をおいて」とは言わず、数えない", async () => {
    for (const status of [402, 403, 401]) {
      const r = await run(alice, aliceId, aliceProject, async () => {
        throw new AiUnavailableError("gemini", status);
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toContain("AI の画像はいま使えません（運営者に知らせました");
        expect(r.message).not.toContain("時間をおいて");
        expect(r.remainingImages).toBe(PHOTO_LIMITS.userMonthlyImages - 3);
      }
    }
    expect((await photoStatus(admin, aliceId, MODEL, { asOf: OLD, scopeOwner: aliceId })).usedImages).toBe(3);
  });

  it("費用: 請求されないとはっきりしている失敗（408 を除く HTTP の 4xx・支払いと鍵）だけ 0 にし、タイムアウト・5xx・200 の中の安全の決まりの断りは見込みの額のまま残す。枚数はできた分だけ", async () => {
    // その回の記録（created_at はテストの時刻で同じになるので、前からある id を除いて探す）
    const jobOf = async (generate: GenerateImage) => {
      const before = new Set(((await admin.from("ai_image_jobs").select("id").eq("owner_id", aliceId)).data ?? []).map((j) => j.id));
      await run(alice, aliceId, aliceProject, generate);
      const { data } = await admin.from("ai_image_jobs").select("id, status, images, cost_usd").eq("owner_id", aliceId);
      const job = data!.find((j) => !before.has(j.id))!;
      return { status: job.status, images: job.images, cost: Number(job.cost_usd) };
    };
    const one = estimateImageCostUsd(MODEL, 1);
    // 安全の決まりの断り: HTTP の 400 で断られたら請求されない。200 の返事の中で断られたら、請求されたかわからないので見込みの額
    expect(await jobOf(async () => { throw new ImageBlockedError("blocked", 400); })).toEqual({ status: "failed", images: 0, cost: 0 });
    expect(await jobOf(async () => { throw new ImageBlockedError("failed"); })).toEqual({ status: "failed", images: 0, cost: estimateImageCostUsd(MODEL, 2) });
    expect(await jobOf(async () => { throw new AiRequestRejected(400, "Gemini API 400"); })).toEqual({ status: "failed", images: 0, cost: 0 });
    expect(await jobOf(async () => { throw new AiUnavailableError("gemini", 402); })).toEqual({ status: "failed", images: 0, cost: 0 });
    // タイムアウト・5xx は請求されたかわからない（2 枚とも）
    expect(await jobOf(async () => { throw new Error("Gemini API 503"); })).toEqual({ status: "failed", images: 0, cost: estimateImageCostUsd(MODEL, 2) });
    // 1 枚できて 1 枚がタイムアウトなら、できた 1 枚の額と、タイムアウトの 1 枚の見込みの額
    let n = 0;
    const partial = await jobOf(async (a) => {
      if (n++ === 0) throw new Error("timeout");
      return fakeImage(a);
    });
    expect(partial.status).toBe("done");
    expect(partial.images).toBe(1);
    expect(partial.cost).toBeCloseTo(estimateImageCostUsd(MODEL, 1, 120) + one, 6);
  });

  it("他人のプロジェクトでは作れない", async () => {
    const r = await run(alice, aliceId, bobProject, fakeImage);
    expect(r).toMatchObject({ ok: false, message: "プロジェクトが見つかりません。" });
  });

  it("候補に戻ったとき、表示の URL を作り直せるのは、自分の 1 日以内の記録の、自分の候補の置き場所だけ", async () => {
    const urls = await refreshCandidateUrls(admin, aliceId, jobId, paths);
    expect(urls?.map((u) => u.path)).toEqual(paths);
    for (const u of urls!) expect((await fetch(u.url)).ok).toBe(true);
    // 他人の記録・他人の置き場所・形の違う置き場所・多すぎる・1 日より前の記録は断る
    expect(await refreshCandidateUrls(admin, bobId, jobId, paths)).toBeNull();
    expect(await refreshCandidateUrls(admin, bobId, jobId, paths.map((p) => p.replace(aliceId, bobId)))).toBeNull();
    expect(await refreshCandidateUrls(admin, aliceId, jobId, [`${aliceId}/gen/../${bobId}/x.jpg`])).toBeNull();
    expect(await refreshCandidateUrls(admin, aliceId, jobId, [`${aliceId}/${paths[0].split("/gen/")[1]}`])).toBeNull();
    expect(await refreshCandidateUrls(admin, aliceId, jobId, [...paths, ...paths])).toBeNull();
    expect(await refreshCandidateUrls(admin, aliceId, jobId, [])).toBeNull();
    expect(await refreshCandidateUrls(admin, aliceId, jobId, paths, new Date(Date.now() + 25 * 3600_000))).toBeNull();
    // 片付けで消えた候補は作り直せない
    const missing = `${aliceId}/gen/${crypto.randomUUID()}.jpg`;
    expect(await refreshCandidateUrls(admin, aliceId, jobId, [missing])).toBeNull();
  });

  it("添えるとき、自分の 1 日以内の記録なら AI の印を付ける", async () => {
    expect(await ownRecentPhotoJob(admin, aliceId, jobId)).toBe(true);
    expect(await ownRecentPhotoJob(admin, bobId, jobId)).toBe(false);
    const { data: failed } = await admin.from("ai_image_jobs").select("id").eq("owner_id", aliceId).eq("status", "failed").limit(1).single();
    expect(await ownRecentPhotoJob(admin, aliceId, failed!.id)).toBe(false);

    const ticket = await issueUpload(admin, aliceId);
    const res = await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg()), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
    expect(res.ok).toBe(true);
    const file = await verifyUpload(admin, aliceId, ticket.path, { ai: "composite" });
    expect(file.aiGenerated).toBe(true);
    expect(readAiMark(await downloadMedia(admin, ticket.path))).toBe("composite");

    // 利用者は ai_generated を自分で外せない（media_files は select だけ）
    const { error } = await alice.from("media_files").update({ ai_generated: false }).eq("id", file.id);
    expect(error?.code).toBe("42501");
    const { data: row } = await admin.from("media_files").select("ai_generated").eq("id", file.id).single();
    expect(row!.ai_generated).toBe(true);
  });
});

describe("上限（DB の中で固定）", () => {
  it("1 人 月 20 枚。同時に頼んでも超えない", async () => {
    await acknowledgePhotoNotice(admin, bobId);
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve(bobId, bobProject, 2)));
    for (const r of results) expect(r.error).toBeNull();
    const ok = results.filter((r) => r.data?.[0]?.status === "ok");
    expect(ok).toHaveLength(10);
    expect(results.filter((r) => r.data?.[0]?.status === "user_limit")).toHaveLength(2);
    const r = await run(bob, bobId, bobProject, fakeImage, { count: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("上限（1 人 20 枚）");
      expect(r.remainingImages).toBe(0);
    }
    expect((await photoStatus(admin, bobId, MODEL, { asOf: OLD, scopeOwner: bobId })).remainingImages).toBe(0);
  });

  it("全体の月の費用（$6.66）を超える予約はしない", async () => {
    await acknowledgePhotoNotice(admin, carolId);
    await admin.from("ai_image_jobs").insert({ owner_id: carolId, project_id: carolProject, model: MODEL, images: 0, cost_usd: 6.64, status: "done" });
    const { data } = await reserve(carolId, carolProject, 1);
    expect(data?.[0]?.status).toBe("global_limit");
    const r = await run(carol, carolId, carolProject, fakeImage, { count: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("yabumi 全体の上限");
  });

  it("枚数と費用の値がおかしい予約は受け付けない", async () => {
    for (const [images, cost] of [[0, 0.03], [5, 0.2], [1, 0], [1, -1]] as const) {
      const { error } = await admin.rpc("reserve_ai_images", { p_owner_id: carolId, p_project_id: carolProject, p_model: MODEL, p_images: images, p_cost_usd: cost, p_scope_owner: carolId, p_as_of: OLD.toISOString() });
      expect(error?.code).toBe("22023");
    }
  });
});

describe("退会したとき", () => {
  it("記録は紐づけを外して残し（全体の上限に数え続ける）、中身は数・費用・日時だけ", async () => {
    const { client: dave, userId: daveId } = await signUpNewUser();
    const project = (await dave.from("projects").insert({ name: "古書店" }).select("id").single()).data!.id;
    await acknowledgePhotoNotice(admin, daveId);
    const r = await run(dave, daveId, project, fakeImage, { count: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await removeStorage(daveId);
    await deleteUser(daveId);
    const { data: job } = await admin.from("ai_image_jobs").select("*").eq("id", r.jobId).single();
    expect(Object.keys(job!).sort()).toEqual(["by_new_user", "cost_usd", "created_at", "id", "images", "model", "owner_id", "project_id", "status"]);
    expect(job).toMatchObject({ owner_id: null, project_id: null, images: 1, status: "done" });
    expect(Number(job!.cost_usd)).toBeGreaterThan(0);
    // 注意を読んだ記録は消える
    expect((await admin.from("ai_image_notices").select("owner_id").eq("owner_id", daveId)).data).toEqual([]);
    await admin.from("ai_image_jobs").delete().eq("id", r.jobId);
  });
});

describe("権限", () => {
  it("他人の記録と注意の記録は読めない。自分のものは読める", async () => {
    expect((await bob.from("ai_image_jobs").select("id").eq("owner_id", aliceId)).data).toEqual([]);
    expect((await bob.from("ai_image_notices").select("owner_id").eq("owner_id", aliceId)).data).toEqual([]);
    expect((await alice.from("ai_image_jobs").select("id")).data!.length).toBeGreaterThan(0);
    expect((await alice.from("ai_image_notices").select("owner_id")).data).toEqual([{ owner_id: aliceId }]);
  });

  it("利用者は記録を書けない（予約を飛ばして作ったことにできない）", async () => {
    const ins = await alice.from("ai_image_jobs").insert({ owner_id: aliceId, model: MODEL, images: 0, cost_usd: 0 });
    expect(ins.error?.code).toBe("42501");
    const upd = await alice.from("ai_image_jobs").update({ status: "failed" }).eq("owner_id", aliceId);
    expect(upd.error?.code).toBe("42501");
    const del = await alice.from("ai_image_jobs").delete().eq("owner_id", aliceId);
    expect(del.error?.code).toBe("42501");
    const notice = await bob.from("ai_image_notices").insert({ owner_id: bobId });
    expect(notice.error?.code).toBe("42501");
  });

  it("ログインしていない人は読めず、予約の関数は利用者からは呼べない", async () => {
    const anon = anonClient();
    expect((await anon.from("ai_image_jobs").select("id")).error?.code).toBe("42501");
    expect((await anon.from("ai_image_notices").select("owner_id")).error?.code).toBe("42501");
    const r = await alice.rpc("reserve_ai_images", { p_owner_id: aliceId, p_project_id: aliceProject, p_model: MODEL, p_images: 1, p_cost_usd: 0.0336 });
    expect(r.error?.code).toBe("42501");
  });
});
