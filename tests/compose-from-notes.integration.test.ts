// 「投稿をつくる」の「ネタ帳から」（2026-11-02、オーナーの要望）。メモの画像を、まだ添えていない投稿の画像として写すことと、
// 保存したときの「投稿にした」の印（同じプロジェクトの、まだ使っていないメモだけ）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { issueUpload, verifyUpload } from "@/lib/media/store";
import { copyNoteImageForCompose, createNote, markNotesUsed } from "@/lib/notes/store";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let otherProjectId: string;

async function uploadImage(ownerId: string) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg({ width: 640, height: 480 })), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  expect(res.ok).toBe(true);
  return verifyUpload(admin, ownerId, ticket.path);
}

async function note(client: TestClient, ownerId: string, project: string, body: string, withImage = false) {
  const mediaId = withImage ? (await uploadImage(ownerId)).id : null;
  const r = await createNote(client, admin, { userId: ownerId, projectId: project, body, mediaId });
  if (!r.ok) throw new Error(r.message);
  return r.noteId;
}

async function draft(client: TestClient, project: string) {
  const { data, error } = await client.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: project,
    p_body: "下書き",
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [],
  });
  if (error) throw error;
  return data as string;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "まちの教室" }).select("id").single()).data!.id;
  otherProjectId = (await alice.from("projects").insert({ name: "べつの教室" }).select("id").single()).data!.id;
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("メモの画像を投稿の画像として写す", () => {
  it("写した画像はメモとは別の、まだ添えていない画像になり、メモの画像は残る", async () => {
    const noteId = await note(alice, aliceId, projectId, "新しいメニュー", true);
    const r = await copyNoteImageForCompose(alice, admin, { userId: aliceId, projectId, noteId });
    expect(r.ok).toBe(true);
    const image = r.ok ? r.image : null;
    expect(image).toMatchObject({ width: 640, height: 480 });
    const { data: row } = await admin.from("media_files").select("owner_id, post_id, note_id, storage_path").eq("id", image!.id).single();
    expect(row).toMatchObject({ owner_id: aliceId, post_id: null, note_id: null });
    expect(row!.storage_path.startsWith(`${aliceId}/`)).toBe(true);
    const { data: original } = await admin.from("media_files").select("id").eq("note_id", noteId);
    expect(original).toHaveLength(1);
    expect(original![0].id).not.toBe(image!.id);
  });

  it("写真のないメモは image: null", async () => {
    const noteId = await note(alice, aliceId, projectId, "写真なし");
    expect(await copyNoteImageForCompose(alice, admin, { userId: aliceId, projectId, noteId })).toEqual({ ok: true, image: null });
  });

  it("他人のメモ・別のプロジェクトのメモからは写せない", async () => {
    const noteId = await note(alice, aliceId, projectId, "他人に見せない", true);
    expect(await copyNoteImageForCompose(bob, admin, { userId: bobId, projectId, noteId })).toMatchObject({ ok: false });
    expect(await copyNoteImageForCompose(alice, admin, { userId: aliceId, projectId: otherProjectId, noteId })).toMatchObject({ ok: false });
  });
});

describe("保存したときの「投稿にした」の印", () => {
  it("同じプロジェクトの、まだ使っていないメモだけに付ける", async () => {
    const a = await note(alice, aliceId, projectId, "ひとつめ");
    const b = await note(alice, aliceId, projectId, "ふたつめ");
    const other = await note(alice, aliceId, otherProjectId, "べつのプロジェクト");
    const used = await note(alice, aliceId, projectId, "もう使った");
    const earlier = await draft(alice, projectId);
    await markNotesUsed(alice, [used], earlier, projectId);

    const postId = await draft(alice, projectId);
    await markNotesUsed(alice, [a, b, other, used], postId, projectId);
    const { data } = await alice.from("idea_notes").select("id, post_id, used_at").in("id", [a, b, other, used]);
    const byId = Object.fromEntries((data ?? []).map((n) => [n.id, n]));
    expect(byId[a]).toMatchObject({ post_id: postId });
    expect(byId[b]).toMatchObject({ post_id: postId });
    expect(byId[a].used_at).not.toBeNull();
    expect(byId[other]).toMatchObject({ post_id: null, used_at: null });
    // 前に投稿にしたメモは、前の投稿のまま
    expect(byId[used]).toMatchObject({ post_id: earlier });
  });

  it("他人のメモには付けられない", async () => {
    const mine = await note(alice, aliceId, projectId, "アリスのメモ");
    const bobProject = (await bob.from("projects").insert({ name: "ボブの店" }).select("id").single()).data!.id;
    const bobPost = await draft(bob, bobProject);
    await markNotesUsed(bob, [mine], bobPost, bobProject);
    const { data } = await alice.from("idea_notes").select("post_id, used_at").eq("id", mine).single();
    expect(data).toEqual({ post_id: null, used_at: null });
  });
});
