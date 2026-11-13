// 整えた画像の元を DB に持つ（docs/architecture.md の 4.68）。投稿の保存・整え直し・元に戻す・外す・片付け・数・ほかの人の画像
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { initialHeadline } from "@/lib/media/headline";
import { attachMedia, issueUpload, unattachedCount, verifyUpload } from "@/lib/media/store";
import { toAttached } from "@/lib/media/attached";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
const headline = { ...initialHeadline({ width: 1080, height: 1350 }, "お店"), headline: "日曜の朝" };
const edit = { kind: "headline" as const, headline };

async function upload(ownerId: string) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg()), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  expect(res.ok).toBe(true);
  return (await verifyUpload(admin, ownerId, ticket.path)).id;
}
async function newPost() {
  const { data, error } = await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: projectId, p_body: "整えた画像", p_planned_at: null as unknown as string, p_status: "draft", p_targets: [{ sns: "threads" }] });
  if (error) throw error;
  return data!;
}
const row = async (id: string) => (await admin.from("media_files").select("id, post_id, source_of, original_id, edit_base_id, edit, has_text, storage_path").eq("id", id).maybeSingle()).data;
const exists = async (path: string) => Boolean((await admin.storage.from(MEDIA_BUCKET).download(path)).data);

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "整えた画像" }).select("id").single()).data!.id;
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("整えた画像の元", () => {
  it("保存すると、添えた画像に元と整え方を持ち、元は投稿に添えずにその画像を指す。数・片付けから外れる。開くと「見出しを直す」の形に戻る", async () => {
    const post = await newPost();
    const photo = await upload(aliceId);
    const made = await upload(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: made, altText: "", originalId: photo, editBaseId: photo, edit, hasText: true }]);
    expect(await row(made)).toMatchObject({ post_id: post, original_id: photo, edit_base_id: photo, has_text: true, edit: { kind: "headline" } });
    expect(await row(photo)).toMatchObject({ post_id: null, source_of: made });
    expect(await unattachedCount(admin, aliceId)).toBe(0);
    // 1 日たっても、元の画像は片付けない
    await admin.from("media_files").update({ created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq("id", photo);
    const { data: cands } = await admin.rpc("cleanup_media_candidates", { p_limit: 100, p_owner_id: aliceId });
    expect((cands ?? []).some((c: { media_id: string | null }) => c.media_id === photo)).toBe(false);
    // 開くとき: 本人の権限で、元も読める
    const { data: files } = await alice.from("media_files").select("*").eq("post_id", post);
    const { data: sources } = await alice.from("media_files").select("*").in("source_of", [made]);
    const img = toAttached(files![0], new Map(), new Map((sources ?? []).map((s) => [s.id, s])));
    expect(img.original?.id).toBe(photo);
    expect(img.edit).toMatchObject({ kind: "headline", base: { id: photo }, headline });
    expect(img.text).toBe(true);
  });

  it("整え直すと元は新しい画像を指し、前の画像は消える。元に戻すと元が添えた画像になり、使わなくなった画像は消える", async () => {
    const post = await newPost();
    const photo = await upload(aliceId);
    const first = await upload(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: first, altText: "", originalId: photo, editBaseId: photo, edit, hasText: true }]);
    const second = await upload(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: second, altText: "", originalId: photo, editBaseId: photo, edit, hasText: true }]);
    expect(await row(first)).toBeNull();
    expect(await row(photo)).toMatchObject({ source_of: second });
    const secondPath = (await row(second))!.storage_path;
    await attachMedia(admin, aliceId, post, [{ id: photo, altText: "", hasText: false }]);
    expect(await row(photo)).toMatchObject({ post_id: post, source_of: null, original_id: null, edit: null, has_text: false });
    expect(await row(second)).toBeNull();
    expect(await exists(secondPath)).toBe(false);
  });

  it("画像を外すと、元の画像の行とファイルも一緒に消える", async () => {
    const post = await newPost();
    const photo = await upload(aliceId);
    const made = await upload(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: made, altText: "", originalId: photo, editBaseId: photo, edit, hasText: true }]);
    const photoPath = (await row(photo))!.storage_path;
    await attachMedia(admin, aliceId, post, []);
    expect(await row(made)).toBeNull();
    expect(await row(photo)).toBeNull();
    expect(await exists(photoPath)).toBe(false);
  });

  it("ほかの人の画像・ほかの投稿の画像の元は、元にできない（整え方を持たせず、その画像は変えない）", async () => {
    const post = await newPost();
    const other = await newPost();
    const bobPhoto = await upload(bobId);
    const made = await upload(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: made, altText: "", originalId: bobPhoto, editBaseId: bobPhoto, edit, hasText: true }]);
    expect(await row(made)).toMatchObject({ original_id: null, edit_base_id: null, edit: null });
    expect(await row(bobPhoto)).toMatchObject({ source_of: null });
    // ほかの投稿の画像の元
    const photo = await upload(aliceId);
    const otherMade = await upload(aliceId);
    await attachMedia(admin, aliceId, other, [{ id: otherMade, altText: "", originalId: photo, editBaseId: photo, edit, hasText: true }]);
    const mine = await upload(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: made, altText: "" }, { id: mine, altText: "", originalId: photo, editBaseId: photo, edit, hasText: true }]);
    expect(await row(mine)).toMatchObject({ original_id: null, edit: null });
    expect(await row(photo)).toMatchObject({ source_of: otherMade });
    // ほかの投稿の画像の元を、この投稿に添えることもできない
    await expect(attachMedia(admin, aliceId, post, [{ id: photo, altText: "" }])).rejects.toThrow();
  });

  it("利用者は、元や整え方の列を直接書けない（読むだけ）", async () => {
    const photo = await upload(aliceId);
    const { data } = await alice.from("media_files").update({ source_of: null, edit: { kind: "headline" } }).eq("id", photo).select("id");
    expect(data ?? []).toEqual([]);
  });

  it("元の画像は投稿に添えられない（DB の check）", async () => {
    const post = await newPost();
    const photo = await upload(aliceId);
    const made = await upload(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: made, altText: "", originalId: photo, editBaseId: photo, edit, hasText: true }]);
    const { error } = await admin.from("media_files").update({ post_id: post }).eq("id", photo);
    expect(error).not.toBeNull();
  });
});
