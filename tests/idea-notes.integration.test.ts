// ネタ帳（F17。docs/architecture.md の 4.26）。メモの RLS と権限、画像の扱い（4.18 の置き場所）、下書きにする流れ。
// 画像はローカルの Supabase Storage に本当に上げる。片付けは、テストの利用者の分だけに絞って呼ぶ
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { cleanupMedia, issueUpload, verifyUpload } from "@/lib/media/store";
import { createNote, deleteNote, noteToDraft, updateNote } from "@/lib/notes/store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
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

async function objectExists(path: string) {
  const { data } = await admin.storage.from(MEDIA_BUCKET).download(path);
  return Boolean(data);
}

async function noteImage(noteId: string) {
  return (await admin.from("media_files").select("*").eq("note_id", noteId).maybeSingle()).data;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "かけいぼ日和" }).select("id").single()).data!.id;
  otherProjectId = (await alice.from("projects").insert({ name: "べつのアプリ" }).select("id").single()).data!.id;
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("メモを残す", () => {
  it("本文だけ・画像つきで残せる。本文も画像もなければ残さない", async () => {
    const text = await createNote(alice, admin, { userId: aliceId, projectId, body: "  朝の電車で思いついた  ", mediaId: null });
    expect(text.ok).toBe(true);
    const { data } = await alice.from("idea_notes").select("body, used_at, post_id").eq("id", text.ok ? text.noteId : "");
    expect(data).toEqual([{ body: "朝の電車で思いついた", used_at: null, post_id: null }]);

    const img = await uploadImage(aliceId);
    const withImage = await createNote(alice, admin, { userId: aliceId, projectId, body: "", mediaId: img.id });
    expect(withImage.ok).toBe(true);
    expect((await noteImage(withImage.ok ? withImage.noteId : ""))?.id).toBe(img.id);

    expect(await createNote(alice, admin, { userId: aliceId, projectId, body: " ", mediaId: null })).toMatchObject({ ok: false });
    expect(await createNote(alice, admin, { userId: aliceId, projectId, body: "あ".repeat(2001), mediaId: null })).toMatchObject({ ok: false });
  });

  it("他人の画像・他人のプロジェクトには残せない", async () => {
    const bobImage = await uploadImage(bobId);
    expect(await createNote(alice, admin, { userId: aliceId, projectId, body: "x", mediaId: bobImage.id })).toMatchObject({ ok: false });
    expect(await createNote(bob, admin, { userId: bobId, projectId, body: "x", mediaId: null })).toMatchObject({ ok: false });
    // 画面を通さずに入れようとしても、RLS で入らない
    expect((await bob.from("idea_notes").insert({ project_id: projectId, body: "x" })).error).not.toBeNull();
  });
});

describe("RLS と権限", () => {
  let noteId: string;
  beforeAll(async () => {
    const r = await createNote(alice, admin, { userId: aliceId, projectId, body: "他人に見せないメモ", mediaId: null });
    noteId = r.ok ? r.noteId : "";
  });

  it("他人は読めず、直せず、消せない", async () => {
    expect((await bob.from("idea_notes").select("id").eq("id", noteId)).data).toEqual([]);
    await bob.from("idea_notes").update({ body: "書き換え" }).eq("id", noteId);
    await bob.from("idea_notes").delete().eq("id", noteId);
    expect((await admin.from("idea_notes").select("body").eq("id", noteId).single()).data?.body).toBe("他人に見せないメモ");
    expect(await deleteNote(bob, admin, { userId: bobId, noteId })).toMatchObject({ ok: false });
    expect(await updateNote(bob, admin, { userId: bobId, noteId, body: "x", image: "keep" })).toMatchObject({ ok: false });
  });

  it("ログインしていない人は読めない（権限がない）", async () => {
    expect((await anonClient().from("idea_notes").select("*").limit(1)).error?.code).toBe("42501");
  });

  it("プロジェクトと持ち主は変えられない（権限がない）。結びつける投稿は、本人の同じプロジェクトのものだけ", async () => {
    expect((await alice.from("idea_notes").update({ project_id: otherProjectId }).eq("id", noteId)).error?.code).toBe("42501");
    expect((await alice.from("idea_notes").update({ owner_id: bobId }).eq("id", noteId)).error?.code).toBe("42501");
    const { data: otherPost } = await alice.rpc("save_post", {
      p_post_id: null as unknown as string,
      p_project_id: otherProjectId,
      p_body: "別のプロジェクト",
      p_planned_at: null as unknown as string,
      p_status: "draft",
      p_targets: [],
    });
    expect((await alice.from("idea_notes").update({ post_id: otherPost! }).eq("id", noteId)).error).not.toBeNull();
  });
});

describe("画像の扱い", () => {
  it("メモの画像は 1 日たっても片付けで消えず、添えていない画像の数にも数えない。メモを消すと画像もすぐ消える", async () => {
    const img = await uploadImage(aliceId);
    const r = await createNote(alice, admin, { userId: aliceId, projectId, body: "写真つき", mediaId: img.id });
    const noteId = r.ok ? r.noteId : "";
    await admin.from("media_files").update({ created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq("id", img.id);
    await cleanupMedia(admin, { ownerId: aliceId });
    expect(await objectExists(img.storagePath)).toBe(true);

    const { count } = await admin.from("media_files").select("id", { count: "exact", head: true }).eq("owner_id", aliceId).is("post_id", null).is("note_id", null);
    expect(count).toBe(0);

    expect(await deleteNote(alice, admin, { userId: aliceId, noteId })).toEqual({ ok: true });
    expect(await objectExists(img.storagePath)).toBe(false);
    expect((await admin.from("media_files").select("id").eq("id", img.id)).data).toEqual([]);
  });

  it("直すときに画像を外す・替えると、前の画像はすぐ消える", async () => {
    const first = await uploadImage(aliceId);
    const r = await createNote(alice, admin, { userId: aliceId, projectId, body: "替える", mediaId: first.id });
    const noteId = r.ok ? r.noteId : "";
    const second = await uploadImage(aliceId);
    expect(await updateNote(alice, admin, { userId: aliceId, noteId, body: "替えた", image: second.id })).toEqual({ ok: true });
    expect(await objectExists(first.storagePath)).toBe(false);
    expect((await noteImage(noteId))?.id).toBe(second.id);

    // 本文がなく画像も外すと、空になるので直さない
    expect(await updateNote(alice, admin, { userId: aliceId, noteId, body: "", image: null })).toMatchObject({ ok: false });
    expect(await updateNote(alice, admin, { userId: aliceId, noteId, body: "画像なし", image: null })).toEqual({ ok: true });
    expect(await noteImage(noteId)).toBeNull();
    expect(await objectExists(second.storagePath)).toBe(false);
  });

  it("プロジェクトを消すと、メモが消え、画像は片付けの対象になる", async () => {
    const tmp = (await alice.from("projects").insert({ name: "消すプロジェクト" }).select("id").single()).data!.id;
    const img = await uploadImage(aliceId);
    const r = await createNote(alice, admin, { userId: aliceId, projectId: tmp, body: "消える", mediaId: img.id });
    expect(r.ok).toBe(true);
    await alice.from("projects").delete().eq("id", tmp);
    expect((await admin.from("idea_notes").select("id").eq("project_id", tmp)).data).toEqual([]);
    await admin.from("media_files").update({ created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }).eq("id", img.id);
    await cleanupMedia(admin, { ownerId: aliceId });
    expect(await objectExists(img.storagePath)).toBe(false);
  });
});

describe("下書きにする", () => {
  it("本文をそのまま下書きにし、画像を投稿の側に写して、メモに「投稿にした」の印とリンクを付ける", async () => {
    const img = await uploadImage(aliceId);
    const r = await createNote(alice, admin, { userId: aliceId, projectId, body: "グラフが見にくいと言われた", mediaId: img.id });
    const noteId = r.ok ? r.noteId : "";
    const d = await noteToDraft(alice, admin, { userId: aliceId, projectId, noteId, accounts: {} });
    expect(d).toMatchObject({ ok: true, skippedImages: 0 });
    const postId = d.ok ? d.postId : "";

    const { data: post } = await alice.from("posts").select("body, status").eq("id", postId).single();
    expect(post).toEqual({ body: "グラフが見にくいと言われた", status: "draft" });
    const { data: postImages } = await admin.from("media_files").select("storage_path, note_id, width").eq("post_id", postId);
    expect(postImages).toHaveLength(1);
    expect(postImages![0].storage_path).not.toBe(img.storagePath);
    expect(postImages![0].width).toBe(640);
    expect(await objectExists(postImages![0].storage_path)).toBe(true);
    // メモの画像はメモに残る
    expect((await noteImage(noteId))?.id).toBe(img.id);

    const { data: note } = await alice.from("idea_notes").select("used_at, post_id").eq("id", noteId).single();
    expect(note!.used_at).not.toBeNull();
    expect(note!.post_id).toBe(postId);

    // 投稿を消しても、「投稿にした」の印は残り、リンクだけ空になる
    await alice.from("posts").delete().eq("id", postId);
    const { data: after } = await alice.from("idea_notes").select("used_at, post_id").eq("id", noteId).single();
    expect(after!.used_at).not.toBeNull();
    expect(after!.post_id).toBeNull();
  });

  it("他人のメモは下書きにできない", async () => {
    const r = await createNote(alice, admin, { userId: aliceId, projectId, body: "alice のメモ", mediaId: null });
    expect(await noteToDraft(bob, admin, { userId: bobId, projectId, noteId: r.ok ? r.noteId : "", accounts: {} })).toMatchObject({ ok: false });
  });
});
