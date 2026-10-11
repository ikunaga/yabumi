// 投稿に添える画像（docs/architecture.md の 4.18）。ローカルの Supabase Storage に本当に上げて確かめる。
// 片付けは、テストの利用者の分だけに絞って呼ぶ（ローカル DB のほかの人の画像を消さないため）
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { MAX_PENDING_TICKETS, MediaError, attachMedia, cleanupMedia, discardUnattached, issueUpload, postMedia, publishImagesFor, verifyUpload } from "@/lib/media/store";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { EXIF_GPS_MARK, includesAscii, testJpeg } from "./helpers/jpeg";

const admin = adminClient();

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

async function putToSignedUrl(signedUrl: string, bytes: Uint8Array, contentType = "image/jpeg") {
  return fetch(signedUrl, { method: "PUT", body: Buffer.from(bytes), headers: { "Content-Type": contentType, "x-upsert": "false" } });
}

// 画面と同じ流れ: URL を発行 → 上げる → 確かめる
async function uploadImage(ownerId: string, bytes = testJpeg()) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await putToSignedUrl(ticket.signedUrl, bytes);
  expect(res.ok).toBe(true);
  return verifyUpload(admin, ownerId, ticket.path);
}

async function newPost(client: TestClient, project: string) {
  const { data, error } = await client.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: project,
    p_body: "画像つき",
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns: "threads" }],
  });
  if (error) throw error;
  return data!;
}

async function objectExists(path: string) {
  const { data } = await admin.storage.from(MEDIA_BUCKET).download(path);
  return Boolean(data);
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "画像" }).select("id").single()).data!.id;
});

afterAll(async () => {
  // 画像のファイルは Storage の API でしか消せないので、退会と同じく片付ける
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("上げて確かめる", () => {
  it("署名つきの URL で上げ、位置情報などを消して記録する", async () => {
    const file = await uploadImage(aliceId, testJpeg({ width: 800, height: 600 }));
    expect(file).toMatchObject({ width: 800, height: 600, altText: "" });
    const { data } = await admin.storage.from(MEDIA_BUCKET).download(file.storagePath);
    const stored = new Uint8Array(await data!.arrayBuffer());
    expect(includesAscii(stored, EXIF_GPS_MARK)).toBe(false);
    expect(file.sizeBytes).toBe(stored.length);
    // 引換券は使ったら消える
    expect((await admin.from("media_upload_tickets").select("storage_path").eq("storage_path", file.storagePath)).data).toEqual([]);
  });

  it("JPEG でない中身は、Content-Type をごまかしても受け付けず、ファイルも消す", async () => {
    const ticket = await issueUpload(admin, aliceId);
    await putToSignedUrl(ticket.signedUrl, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"));
    await expect(verifyUpload(admin, aliceId, ticket.path)).rejects.toBeInstanceOf(MediaError);
    expect(await objectExists(ticket.path)).toBe(false);
  });

  it("バケットは JPEG 以外の Content-Type を受け付けない", async () => {
    const ticket = await issueUpload(admin, aliceId);
    const res = await putToSignedUrl(ticket.signedUrl, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
    expect(res.ok).toBe(false);
    await admin.from("media_upload_tickets").delete().eq("storage_path", ticket.path);
  });

  it("発行していない場所・他人のフォルダは確かめない", async () => {
    const path = `${aliceId}/${randomUUID()}.jpg`;
    await admin.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(testJpeg()), { contentType: "image/jpeg" });
    await expect(verifyUpload(admin, aliceId, path)).rejects.toBeInstanceOf(MediaError);
    const ticket = await issueUpload(admin, aliceId);
    await putToSignedUrl(ticket.signedUrl, testJpeg());
    await expect(verifyUpload(admin, bobId, ticket.path)).rejects.toBeInstanceOf(MediaError);
    await discardUnattached(admin, aliceId, (await verifyUpload(admin, aliceId, ticket.path)).id);
  });

  it("利用者は Storage に直接上げられず、他人の画像も読めない", async () => {
    const up = await alice.storage.from(MEDIA_BUCKET).upload(`${aliceId}/${randomUUID()}.jpg`, Buffer.from(testJpeg()), { contentType: "image/jpeg" });
    expect(up.error).not.toBeNull();
    const file = await uploadImage(aliceId);
    expect((await bob.storage.from(MEDIA_BUCKET).download(file.storagePath)).data).toBeNull();
    expect((await alice.storage.from(MEDIA_BUCKET).download(file.storagePath)).data).toBeNull();
    expect((await bob.from("media_files").select("id").eq("id", file.id)).data).toEqual([]);
    expect((await alice.from("media_files").select("id").eq("id", file.id)).data).toHaveLength(1);
    await discardUnattached(admin, aliceId, file.id);
  });

  it("同時にたくさん頼まれても、確かめ待ちの URL は上限までしか発行しない", async () => {
    const { userId } = await signUpNewUser();
    try {
      const results = await Promise.allSettled(Array.from({ length: MAX_PENDING_TICKETS + 5 }, () => issueUpload(admin, userId)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_PENDING_TICKETS);
      expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof MediaError)).toBe(true);
    } finally {
      await deleteUser(userId);
    }
  });
});

describe("投稿に添える", () => {
  it("並び順と代わりの文を保存し、外した画像はファイルごと消す", async () => {
    const postId = await newPost(alice, projectId);
    const [a, b, c] = [await uploadImage(aliceId), await uploadImage(aliceId), await uploadImage(aliceId)];
    await attachMedia(admin, aliceId, postId, [
      { id: b.id, altText: " 2 枚目 " },
      { id: a.id, altText: "" },
      { id: c.id, altText: "3" },
    ]);
    expect((await postMedia(alice, postId)).map((m) => [m.id, m.altText])).toEqual([
      [b.id, "2 枚目"],
      [a.id, ""],
      [c.id, "3"],
    ]);
    await attachMedia(admin, aliceId, postId, [{ id: c.id, altText: "3" }]);
    expect((await postMedia(alice, postId)).map((m) => m.id)).toEqual([c.id]);
    expect(await objectExists(a.storagePath)).toBe(false);
    expect(await objectExists(b.storagePath)).toBe(false);

    // 送るときの画像: 期限つきの URL と中身
    const images = await publishImagesFor(admin, postId);
    expect(images).toHaveLength(1);
    expect(images[0].url).toContain("token=");
    expect((await fetch(images[0].url)).ok).toBe(true);
    expect((await images[0].load()).length).toBe(c.sizeBytes);
  });

  it("他人の画像・他人の投稿・別の投稿に添えた画像は添えられない", async () => {
    const bobFile = await uploadImage(bobId);
    const postId = await newPost(alice, projectId);
    await expect(attachMedia(admin, aliceId, postId, [{ id: bobFile.id, altText: "" }])).rejects.toBeInstanceOf(MediaError);
    const bobProject = (await bob.from("projects").insert({ name: "B" }).select("id").single()).data!.id;
    const bobPost = await newPost(bob, bobProject);
    const mine = await uploadImage(aliceId);
    await expect(attachMedia(admin, aliceId, bobPost, [{ id: mine.id, altText: "" }])).rejects.toBeInstanceOf(MediaError);
    await attachMedia(admin, aliceId, postId, [{ id: mine.id, altText: "" }]);
    const other = await newPost(alice, projectId);
    await expect(attachMedia(admin, aliceId, other, [{ id: mine.id, altText: "" }])).rejects.toBeInstanceOf(MediaError);
    await expect(attachMedia(admin, aliceId, postId, Array.from({ length: 11 }, () => ({ id: mine.id, altText: "" })))).rejects.toBeInstanceOf(MediaError);
  });
});

describe("片付け（テストの利用者だけに絞る）", () => {
  it("添えないまま 1 日たった画像、投稿が消えた画像、記録のないファイルを消す。新しいものは残す", async () => {
    const { userId } = await signUpNewUser();
    try {
      const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const fresh = await uploadImage(userId);
      const stale = await uploadImage(userId);
      await admin.from("media_files").update({ created_at: old }).eq("id", stale.id);

      const p = (await admin.from("projects").insert({ name: "片付け", owner_id: userId }).select("id").single()).data!.id;
      const post = (await admin.from("posts").insert({ project_id: p, owner_id: userId, body: "x" }).select("id").single()).data!.id;
      const attached = await uploadImage(userId);
      await attachMedia(admin, userId, post, [{ id: attached.id, altText: "" }]);
      await admin.from("posts").delete().eq("id", post);
      await admin.from("media_files").update({ created_at: old }).eq("id", attached.id);

      const r = await cleanupMedia(admin, { ownerId: userId });
      expect(r.removed).toBe(2);
      expect(await objectExists(stale.storagePath)).toBe(false);
      expect(await objectExists(attached.storagePath)).toBe(false);
      expect(await objectExists(fresh.storagePath)).toBe(true);
      expect((await admin.from("media_files").select("id").eq("owner_id", userId)).data).toEqual([{ id: fresh.id }]);
    } finally {
      const { data } = await admin.storage.from(MEDIA_BUCKET).list(userId);
      if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${userId}/${f.name}`));
      await deleteUser(userId);
    }
  });
});
