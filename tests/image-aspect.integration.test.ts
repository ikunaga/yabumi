// 縦横を整えて上げ直した画像の、AI の印の引き継ぎ（confirmImageUpload の fromMediaId）。
// 印は、元の画像がこの利用者の AI の画像だとサーバーで確かめたときだけ付く（画面から渡された印を信じない）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();
let current: TestClient;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

import { confirmImageUpload, requestImageUpload } from "@/lib/media/actions";
import { readAiMark } from "@/lib/media/jpeg";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { downloadMedia, issueUpload, ownAiMedia, verifyUpload } from "@/lib/media/store";

let alice: TestClient;
let aliceId: string;
let bobId: string;
let aiMediaId: string;
let plainMediaId: string;
let bobAiMediaId: string;

async function upload(ownerId: string, ai?: "generated") {
  const ticket = await issueUpload(admin, ownerId);
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg()), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  expect(res.ok).toBe(true);
  return verifyUpload(admin, ownerId, ticket.path, { ai });
}

// 画面と同じ流れ（引換券 → 上げる → 確かめる）で、整えた画像を上げる
async function uploadAdjusted(as: TestClient, ai: Parameters<typeof confirmImageUpload>[1]) {
  current = as;
  const { ticket } = await requestImageUpload();
  expect(ticket).toBeTruthy();
  const res = await fetch(ticket!.signedUrl, { method: "PUT", body: Buffer.from(testJpeg({ width: 1080, height: 1350 })), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  expect(res.ok).toBe(true);
  return confirmImageUpload(ticket!.path, ai);
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  aiMediaId = (await upload(aliceId, "generated")).id;
  plainMediaId = (await upload(aliceId)).id;
  bobAiMediaId = (await upload(bobId, "generated")).id;
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    const files = (data ?? []).filter((f) => f.id);
    if (files.length) await admin.storage.from(MEDIA_BUCKET).remove(files.map((f) => `${owner}/${f.name}`));
    await deleteUser(owner);
  }
});

describe("AI の画像を整えたとき", () => {
  it("自分の AI の画像だけを、AI の画像と認める", async () => {
    expect(await ownAiMedia(admin, aliceId, aiMediaId)).toBe(true);
    expect(await ownAiMedia(admin, aliceId, plainMediaId)).toBe(false);
    expect(await ownAiMedia(admin, aliceId, bobAiMediaId)).toBe(false);
  });

  it("自分の AI の画像から整えたら、印（composite）と ai_generated を引き継ぐ", async () => {
    const r = await uploadAdjusted(alice, { fromMediaId: aiMediaId });
    expect(r.image?.aiGenerated).toBe(true);
    expect([r.image?.width, r.image?.height]).toEqual([1080, 1350]);
    expect(readAiMark(await downloadMedia(admin, r.image!.storagePath))).toBe("composite");
  });

  it("ふつうの画像や他人の AI の画像を元だと言っても、印は付かない（上げること自体はできる）", async () => {
    for (const fromMediaId of [plainMediaId, bobAiMediaId]) {
      const r = await uploadAdjusted(alice, { fromMediaId });
      expect(r.image?.aiGenerated).toBe(false);
      expect(readAiMark(await downloadMedia(admin, r.image!.storagePath))).toBeNull();
    }
  });

  it("形のおかしい指定は受け付けない", async () => {
    current = alice;
    const bad = await confirmImageUpload(`${aliceId}/00000000-0000-4000-8000-000000000000.jpg`, { fromMediaId: "x" } as never);
    expect(bad.error).toBe("入力の形式が正しくありません。");
    const mixed = await confirmImageUpload(`${aliceId}/00000000-0000-4000-8000-000000000000.jpg`, { fromMediaId: aiMediaId, source: "generated" } as never);
    expect(mixed.error).toBe("入力の形式が正しくありません。");
  });
});
