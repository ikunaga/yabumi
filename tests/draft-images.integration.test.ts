// 書きかけの画像を戻すときの読み方（restoreDraftImages と同じ: 利用者の権限で読み、restorableRows で絞る。4.62）。
// ほかの人の画像・別の投稿の画像・ない id は戻らない
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { attachMedia, issueUpload, restorableRows, restoreImages, signedUrls, verifyUpload } from "@/lib/media/store";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let bobId: string;
let postA: string;
let postB: string;
const ids: Record<string, string> = {};

const paths: Record<string, string> = {};
async function upload(ownerId: string) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg()), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  expect(res.ok).toBe(true);
  const f = await verifyUpload(admin, ownerId, ticket.path);
  paths[f.id] = f.storagePath;
  return f.id;
}

async function newPost(client: TestClient, project: string) {
  const { data, error } = await client.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: project,
    p_body: "書きかけ",
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns: "threads" }],
  });
  if (error) throw error;
  return data!;
}

async function readAsAlice(list: string[], postId: string | null) {
  const { data, error } = await alice.from("media_files").select("*").in("id", list);
  if (error) throw error;
  return restorableRows(data ?? [], postId, new Date())
    .map((r) => r.id)
    .sort();
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  const projectId = (await alice.from("projects").insert({ name: "書きかけ" }).select("id").single()).data!.id;
  postA = await newPost(alice, projectId);
  postB = await newPost(alice, projectId);
  ids.loose = await upload(aliceId);
  ids.old = await upload(aliceId);
  ids.onA = await upload(aliceId);
  ids.onB = await upload(aliceId);
  ids.bob = await upload(bobId);
  await attachMedia(admin, aliceId, postA, [{ id: ids.onA, altText: "" }]);
  await attachMedia(admin, aliceId, postB, [{ id: ids.onB, altText: "" }]);
  // 片付けの近い、古い添えていない画像
  await admin.from("media_files").update({ created_at: new Date(Date.now() - 23 * 3600_000).toISOString() }).eq("id", ids.old);
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("書きかけの画像を戻す", () => {
  it("この投稿の画像と、本人の添えていない新しい画像だけを戻す", async () => {
    const all = [ids.loose, ids.old, ids.onA, ids.onB, ids.bob, randomUUID()];
    expect(await readAsAlice(all, postA)).toEqual([ids.loose, ids.onA].sort());
  });
  it("新しい投稿では、添えていない新しい画像だけ（ほかの人の画像は RLS で読めない）", async () => {
    expect(await readAsAlice([ids.loose, ids.bob, ids.onB], null)).toEqual([ids.loose]);
    const { data } = await alice.from("media_files").select("id").eq("id", ids.bob);
    expect(data).toEqual([]);
  });

  it("サーバーの権限で URL を作るのは、RLS と restorableRows で絞ったあとの画像だけ。ほかの人の id を混ぜても、その URL は返らない", async () => {
    const signed: string[] = [];
    const sign = async (list: string[]) => {
      signed.push(...list);
      return signedUrls(admin, list, 60);
    };
    const images = await restoreImages(alice, sign, postA, [ids.bob, ids.onA, ids.onB, ids.loose, randomUUID()], new Date());
    // 控えの順に、戻せる画像だけ
    expect(images.map((i) => i.id)).toEqual([ids.onA, ids.loose]);
    expect(images.every((i) => i.previewUrl?.includes(aliceId))).toBe(true);
    // URL を作ったのは、本人の、戻せる画像のパスだけ（ほかの人・別の投稿の画像のパスは渡していない）
    expect(signed.sort()).toEqual([paths[ids.onA], paths[ids.loose]].sort());
    expect(signed.some((p) => p.startsWith(`${bobId}/`))).toBe(false);
    expect(JSON.stringify(images)).not.toContain(bobId);
  });
});
