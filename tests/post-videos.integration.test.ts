// 投稿に添える動画（docs/design/video.md の 3.・6.・7.）。ローカルの Supabase Storage に TUS で本当に上げて確かめる。
// 他人の動画を読めない・上げられない、上限、1 投稿に動画 1 本・画像と混ぜない、画像の数え方、片付け（preparing の間は消さない）、postVideoFor。
// 片付けは、テストの利用者の分だけに絞って呼ぶ（ローカル DB のほかの人のファイルを消さないため）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { MediaError, attachMedia, cleanupMedia, issueUpload, unattachedCount, verifyUpload } from "@/lib/media/store";
import { attachVideo, discardUnattachedVideo, issueVideoUpload, postVideoFor, verifyVideoUpload } from "@/lib/media/video-store";
import { MAX_PENDING_VIDEO_TICKETS, MAX_VIDEO_BYTES, VIDEO_BUCKET, videoPath } from "@/lib/media/video-rules";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";
import { testMp4 } from "./helpers/mp4";
import { seedPostVideo, tusUpload } from "./helpers/video";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;

const DAY = 86_400_000;

async function newPost(targets: { sns: string }[] = [{ sns: "threads" }]) {
  const { data, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "動画つき",
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: targets,
  });
  if (error) throw error;
  return data!;
}

// 画面と同じ流れ: 引換券 → TUS で上げる → 確かめる
async function uploadVideo(ownerId: string, bytes = testMp4()) {
  const ticket = await issueVideoUpload(admin, ownerId);
  expect(await tusUpload({ path: ticket.path, token: ticket.token, bytes })).toBe(204);
  return verifyVideoUpload(admin, ownerId, ticket.path);
}

async function uploadImage(ownerId: string) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg()), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  expect(res.ok).toBe(true);
  return verifyUpload(admin, ownerId, ticket.path);
}

const exists = async (path: string) => Boolean((await admin.storage.from(VIDEO_BUCKET).download(path)).data);
const clearTickets = (ownerId: string) => admin.from("media_upload_tickets").delete().eq("owner_id", ownerId);

async function candidates(ownerId: string, now: Date) {
  const { data, error } = await admin.rpc("cleanup_media_candidates", { p_limit: 100, p_owner_id: ownerId, p_now: now.toISOString() });
  if (error) throw error;
  return data ?? [];
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "動画" }).select("id").single()).data!.id;
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    for (const bucket of [MEDIA_BUCKET, VIDEO_BUCKET]) {
      const { data } = await admin.storage.from(bucket).list(owner, { limit: 1000 });
      if (data?.length) await admin.storage.from(bucket).remove(data.map((f) => `${owner}/${f.name}`));
    }
    await admin.from("media_upload_tickets").delete().eq("owner_id", owner);
    await admin.from("video_upload_counts").delete().eq("owner_id", owner);
    await deleteUser(owner);
  }
});

describe("上げる・確かめる", () => {
  it("引換券の場所に TUS で上げ、確かめると kind = video で、サーバーが読んだ長さ・縦横・大きさで記録する。引換券は消え、月の本数が 1 増える", async () => {
    // 6MB を超えるので、TUS で 2 回に分けて送る
    const bytes = testMp4({ durationMs: 42_000, width: 720, height: 1280, mdatBytes: 7 * 1024 * 1024 });
    const v = await uploadVideo(aliceId, bytes);
    expect(v).toMatchObject({ durationMs: 42_000, width: 720, height: 1280, sizeBytes: bytes.length });
    const { data: row } = await admin.from("media_files").select("kind, owner_id, post_id").eq("id", v.id).single();
    expect(row).toEqual({ kind: "video", owner_id: aliceId, post_id: null });
    // 引換券は消さずに、使った印を付ける（同じ引換券ではもう確かめない）
    const { data: used } = await admin.from("media_upload_tickets").select("consumed_at").eq("storage_path", v.storagePath).single();
    expect(used?.consumed_at).not.toBeNull();
    const { data: counts } = await admin.from("video_upload_counts").select("count").eq("owner_id", aliceId);
    expect(counts?.[0]?.count).toBeGreaterThanOrEqual(1);
    // 本人は自分の行を読める（RLS）
    expect((await alice.from("media_files").select("id").eq("id", v.id)).data).toHaveLength(1);
    await discardUnattachedVideo(admin, aliceId, v.id);
    expect(await exists(v.storagePath)).toBe(false);
  });

  it("形が合わない動画は受け付けず、ファイルを消して引換券に使った印を付ける", async () => {
    const ticket = await issueVideoUpload(admin, aliceId);
    expect(await tusUpload({ path: ticket.path, token: ticket.token, bytes: testMp4({ moovAfterMdat: true }) })).toBe(204);
    await expect(verifyVideoUpload(admin, aliceId, ticket.path)).rejects.toBeInstanceOf(MediaError);
    expect(await exists(ticket.path)).toBe(false);
    expect((await admin.from("media_upload_tickets").select("consumed_at").eq("storage_path", ticket.path).single()).data?.consumed_at).not.toBeNull();
    expect((await admin.from("media_files").select("id").eq("storage_path", ticket.path)).data).toEqual([]);
    // 使った引換券ではもう確かめない（上げ直しても記録しない）
    expect(await tusUpload({ path: ticket.path, token: ticket.token, bytes: testMp4() })).toBe(204);
    await expect(verifyVideoUpload(admin, aliceId, ticket.path)).rejects.toBeInstanceOf(MediaError);
    await admin.storage.from(VIDEO_BUCKET).remove([ticket.path]);
    await clearTickets(aliceId);
  });

  it("断った・外した動画の場所に、まだ使えるトークンで上げ直したファイルは、量の上限に数え、片付けがすぐ消す", async () => {
    const ticket = await issueVideoUpload(admin, bobId);
    expect(await tusUpload({ path: ticket.path, token: ticket.token, bytes: testMp4({ editList: true }) })).toBe(204);
    await expect(verifyVideoUpload(admin, bobId, ticket.path)).rejects.toBeInstanceOf(MediaError);
    expect(await tusUpload({ path: ticket.path, token: ticket.token, bytes: testMp4() })).toBe(204);
    // 上限 1 本分の量だと、上げ直したファイルの分で足りない
    const args = { p_owner_id: bobId, p_max_pending: 2, p_max_unattached: 3, p_quota_bytes: MAX_VIDEO_BYTES, p_max_file_bytes: MAX_VIDEO_BYTES, p_month_limit: 99, p_global_quota_bytes: 1e15 };
    expect((await admin.rpc("issue_video_upload_ticket", { ...args, p_storage_path: videoPath(bobId, crypto.randomUUID()) })).data).toBe("quota");
    // 片付けは 1 日を待たずに、そのファイルを候補にする
    const rows = await candidates(bobId, new Date());
    expect(rows.find((r) => r.storage_path === ticket.path)).toMatchObject({ bucket: VIDEO_BUCKET, media_id: null });
    await cleanupMedia(admin, { ownerId: bobId });
    expect(await exists(ticket.path)).toBe(false);
    await clearTickets(bobId);
  });

  it("引換券のない場所・他人の場所・画像の引換券では確かめない", async () => {
    await expect(verifyVideoUpload(admin, aliceId, videoPath(aliceId, crypto.randomUUID()))).rejects.toBeInstanceOf(MediaError);
    const bobs = await issueVideoUpload(admin, bobId);
    await expect(verifyVideoUpload(admin, aliceId, bobs.path)).rejects.toBeInstanceOf(MediaError);
    await clearTickets(bobId);
  });
});

describe("利用者が直接読める・書ける経路がない", () => {
  it("authenticated・anon は post-videos に上げられず、一覧・ダウンロード・署名 URL も作れない", async () => {
    const { path } = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    const own = `${aliceId}/${crypto.randomUUID()}.mp4`;
    expect((await alice.storage.from(VIDEO_BUCKET).upload(own, testMp4(), { contentType: "video/mp4" })).error).not.toBeNull();
    expect((await anonClient().storage.from(VIDEO_BUCKET).upload(own, testMp4(), { contentType: "video/mp4" })).error).not.toBeNull();
    expect((await alice.storage.from(VIDEO_BUCKET).list(aliceId)).data ?? []).toEqual([]);
    expect((await alice.storage.from(VIDEO_BUCKET).download(path)).data).toBeNull();
    expect((await alice.storage.from(VIDEO_BUCKET).createSignedUrl(path, 60)).data).toBeNull();
    expect((await bob.storage.from(VIDEO_BUCKET).download(path)).data).toBeNull();
  });

  it("署名つきのトークンは、発行した場所にしか使えない（ほかの名前・ほかのバケットには上げられない）", async () => {
    const ticket = await issueVideoUpload(admin, aliceId);
    const other = videoPath(aliceId, crypto.randomUUID());
    expect(await tusUpload({ path: other, token: ticket.token, bytes: testMp4() })).not.toBe(204);
    expect(await tusUpload({ path: ticket.path, token: ticket.token, bytes: testMp4(), bucket: MEDIA_BUCKET })).not.toBe(204);
    expect(await exists(other)).toBe(false);
    await clearTickets(aliceId);
  });

  it("他人の動画の行は読めず、media_files・引換券・月の本数を直接書けず、引換券の関数を呼べない", async () => {
    const { mediaId } = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    expect((await bob.from("media_files").select("id").eq("id", mediaId)).data).toEqual([]);
    expect((await alice.from("media_files").update({ duration_ms: 1 }).eq("id", mediaId)).error?.code).toBe("42501");
    const fake = { owner_id: aliceId, storage_path: videoPath(aliceId, crypto.randomUUID()), kind: "video", duration_ms: 1000, width: 1080, height: 1920, size_bytes: 1 };
    expect((await alice.from("media_files").insert(fake)).error?.code).toBe("42501");
    expect((await alice.from("video_upload_counts").select("*")).error?.code).toBe("42501");
    expect((await alice.from("video_upload_counts").insert({ owner_id: aliceId, month: "2026-11-01", count: 0 })).error?.code).toBe("42501");
    expect((await alice.from("media_upload_tickets").select("*")).error?.code).toBe("42501");
    const args = { p_owner_id: aliceId, p_storage_path: fake.storage_path, p_max_pending: 9, p_max_unattached: 9, p_quota_bytes: 1e12, p_max_file_bytes: 1, p_month_limit: 999, p_global_quota_bytes: 1e12 };
    expect((await alice.rpc("issue_video_upload_ticket", args)).error?.code).toBe("42501");
    expect((await anonClient().rpc("issue_video_upload_ticket", args)).error?.code).toBe("42501");
    expect((await alice.rpc("cleanup_media_candidates", {})).error?.code).toBe("42501");
  });
});

describe("上限", () => {
  const call = (o: Partial<{ pending: number; unattached: number; quota: number; month: number; global: number; path: string }> = {}) =>
    admin.rpc("issue_video_upload_ticket", {
      p_owner_id: bobId,
      p_storage_path: o.path ?? videoPath(bobId, crypto.randomUUID()),
      p_max_pending: o.pending ?? 2,
      p_max_unattached: o.unattached ?? 3,
      p_quota_bytes: o.quota ?? 300 * 1024 * 1024,
      p_max_file_bytes: MAX_VIDEO_BYTES,
      p_month_limit: o.month ?? 20,
      p_global_quota_bytes: o.global ?? 1e15,
    });

  it("確かめ待ちは 2 本まで。同時に 5 本頼んでも 2 本しか出さない", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => issueVideoUpload(admin, bobId).then(() => "ok", (e) => (e instanceof MediaError ? "limit" : String(e)))));
    expect(results.filter((r) => r === "ok")).toHaveLength(MAX_PENDING_VIDEO_TICKETS);
    expect(results.filter((r) => r === "limit")).toHaveLength(5 - MAX_PENDING_VIDEO_TICKETS);
    await clearTickets(bobId);
  });

  it("添えていない動画・置ける量・月の本数・全体の量に当たると、それぞれの理由を返す。画像の引換券は動画の数に入らない", async () => {
    await issueUpload(admin, bobId);
    await issueUpload(admin, bobId);
    expect((await call()).data).toBe("ok");
    await clearTickets(bobId);
    const seeded = await Promise.all([1, 2, 3].map(() => seedPostVideo(admin, { ownerId: bobId, postId: null })));
    expect((await call()).data).toBe("too_many_unattached");
    expect((await call({ unattached: 10, quota: MAX_VIDEO_BYTES })).data).toBe("quota");
    expect((await call({ unattached: 10, global: MAX_VIDEO_BYTES })).data).toBe("global_quota");
    await admin.from("media_files").delete().in("id", seeded.map((s) => s.mediaId));
    await admin.storage.from(VIDEO_BUCKET).remove(seeded.map((s) => s.path));
    expect((await call({ month: 1 })).data).toBe("month_limit");
    await clearTickets(bobId);
  });

  it("置き場所が本人のフォルダの .mp4 でなければ断る", async () => {
    expect((await call({ path: `${aliceId}/${crypto.randomUUID()}.mp4` })).error?.code).toBe("22023");
    expect((await call({ path: `${bobId}/${crypto.randomUUID()}.jpg` })).error?.code).toBe("22023");
  });
});

describe("投稿との関係", () => {
  it("動画を添え、入れ替えると前の動画はファイルごと消え、外すと消える", async () => {
    const post = await newPost();
    const a = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    const b = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    await attachVideo(admin, aliceId, post, a.mediaId);
    expect((await admin.from("media_files").select("post_id").eq("id", a.mediaId).single()).data?.post_id).toBe(post);
    await attachVideo(admin, aliceId, post, b.mediaId);
    expect((await admin.from("media_files").select("id").eq("id", a.mediaId)).data).toEqual([]);
    expect(await exists(a.path)).toBe(false);
    await attachVideo(admin, aliceId, post, null);
    expect((await admin.from("media_files").select("id").eq("id", b.mediaId)).data).toEqual([]);
    expect(await exists(b.path)).toBe(false);
  });

  it("画像のある投稿には動画を添えられない（サーバーでも DB でも）。画像を保存しても動画は消えない", async () => {
    const post = await newPost();
    const img = await uploadImage(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: img.id, altText: "" }]);
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    await expect(attachVideo(admin, aliceId, post, v.mediaId)).rejects.toBeInstanceOf(MediaError);
    expect((await admin.from("media_files").update({ post_id: post }).eq("id", v.mediaId)).error?.code).toBe("23514");

    const post2 = await newPost();
    await attachVideo(admin, aliceId, post2, v.mediaId);
    // 画像の保存（空）で、動画は消えない
    await attachMedia(admin, aliceId, post2, []);
    expect((await admin.from("media_files").select("id").eq("id", v.mediaId)).data).toHaveLength(1);
    // 動画の ID を画像として添えられない
    await expect(attachMedia(admin, aliceId, post2, [{ id: v.mediaId, altText: "" }])).rejects.toBeInstanceOf(MediaError);
  });

  it("1 つの投稿に動画は 2 本入らない。他人の動画・他人の投稿には添えられない", async () => {
    const post = await newPost();
    await seedPostVideo(admin, { ownerId: aliceId, postId: post });
    await expect(seedPostVideo(admin, { ownerId: aliceId, postId: post })).rejects.toMatchObject({ code: "23505" });
    const bobs = await seedPostVideo(admin, { ownerId: bobId, postId: null });
    const post2 = await newPost();
    await expect(attachVideo(admin, aliceId, post2, bobs.mediaId)).rejects.toBeInstanceOf(MediaError);
    const mine = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    await expect(attachVideo(admin, bobId, post2, mine.mediaId)).rejects.toBeInstanceOf(MediaError);
  });

  it("動画はネタ帳のメモ・画像の整えに使えず、kind と拡張子が合わないものは入らない", async () => {
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    const { data: note } = await alice.from("idea_notes").insert({ project_id: projectId, body: "メモ" }).select("id").single();
    expect((await admin.from("media_files").update({ note_id: note!.id }).eq("id", v.mediaId)).error?.code).toBe("23514");
    expect((await admin.from("media_files").update({ edit: { kind: "aspect" } }).eq("id", v.mediaId)).error?.code).toBe("23514");
    const base = { owner_id: aliceId, width: 1080, height: 1920, size_bytes: 1 };
    expect((await admin.from("media_files").insert({ ...base, storage_path: `${aliceId}/${crypto.randomUUID()}.jpg`, kind: "video", duration_ms: 1000 })).error?.code).toBe("23514");
    expect((await admin.from("media_files").insert({ ...base, storage_path: `${aliceId}/${crypto.randomUUID()}.mp4`, kind: "image" })).error?.code).toBe("23514");
    expect((await admin.from("media_files").insert({ ...base, storage_path: `${aliceId}/${crypto.randomUUID()}.mp4`, kind: "video" })).error?.code).toBe("23514");
  });

  it("動画は画像の容量・添えていない画像の数に入らない", async () => {
    const { data: before } = await admin.rpc("media_usage_bytes", { p_owner_id: bobId });
    const countBefore = await unattachedCount(admin, bobId);
    const v = await seedPostVideo(admin, { ownerId: bobId, postId: null, bytes: testMp4({ mdatBytes: 100_000 }) });
    expect((await admin.rpc("media_usage_bytes", { p_owner_id: bobId })).data).toBe(before);
    expect(await unattachedCount(admin, bobId)).toBe(countBefore);
    await discardUnattachedVideo(admin, bobId, v.mediaId);
  });
});

describe("片付け", () => {
  async function sentPost(statuses: string[]) {
    const post = await newPost(statuses.map((_, i) => ({ sns: ["threads", "instagram", "facebook", "x"][i] })));
    const { data: targets } = await admin.from("post_targets").select("id").eq("post_id", post).order("sns");
    for (const [i, t] of (targets ?? []).entries()) {
      const { error } = await admin.from("post_targets").update({ status: statuses[i] }).eq("id", t.id);
      if (error) throw error;
    }
    return post;
  }
  const soon = (days: number) => new Date(Date.now() + days * DAY);
  const pick = (rows: { media_id: string | null }[], id: string) => rows.find((r) => r.media_id === id);

  it("添えていない動画は 1 日で、行ごと消す候補になる（post-videos のファイル）", async () => {
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    expect(pick(await candidates(aliceId, soon(0.5)), v.mediaId)).toBeUndefined();
    expect(pick(await candidates(aliceId, soon(1.1)), v.mediaId)).toMatchObject({ bucket: VIDEO_BUCKET, storage_path: v.path, mark_removed: false });
    await discardUnattachedVideo(admin, aliceId, v.mediaId);
  });

  it("送り終えた動画は 1 日、送れなかった配信先が残れば 7 日。下書き（配信先が pending）・preparing・publishing の間は消さない", async () => {
    const sent = await sentPost(["published", "published"]);
    const failed = await sentPost(["published", "failed"]);
    const preparing = await sentPost(["published", "preparing"]);
    const publishing = await sentPost(["publishing"]);
    const draft = await sentPost(["pending"]);
    const v = Object.fromEntries(
      await Promise.all(Object.entries({ sent, failed, preparing, publishing, draft }).map(async ([k, post]) => [k, (await seedPostVideo(admin, { ownerId: aliceId, postId: post })).mediaId] as const)),
    );
    const day2 = await candidates(aliceId, soon(2));
    expect(pick(day2, v.sent)).toMatchObject({ bucket: VIDEO_BUCKET, mark_removed: true });
    for (const k of ["failed", "preparing", "publishing", "draft"]) expect(pick(day2, v[k])).toBeUndefined();
    const day8 = await candidates(aliceId, soon(8));
    expect(pick(day8, v.failed)).toMatchObject({ mark_removed: true });
    for (const k of ["preparing", "publishing", "draft"]) expect(pick(day8, v[k])).toBeUndefined();
  });

  it("画像も、配信先が preparing の間は消さない", async () => {
    const post = await sentPost(["published", "preparing"]);
    const img = await uploadImage(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: img.id, altText: "" }]);
    expect(pick(await candidates(aliceId, soon(40)), img.id)).toBeUndefined();
  });

  it("片付けると、送った動画はファイルを消して removed_at を入れ（行は残る）、postVideoFor は返さない。投稿を消すと行も消える", async () => {
    const post = await sentPost(["published"]);
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId: post });
    // 片付けの関数は時刻を渡せないので、送った時刻を戻す代わりに、片付けの候補をこの動画だけにして消す（cleanupMedia と同じ処理）
    const rows = (await candidates(aliceId, soon(2))).filter((r) => r.media_id === v.mediaId);
    expect(rows).toHaveLength(1);
    await admin.storage.from(VIDEO_BUCKET).remove([v.path]);
    await admin.from("media_files").update({ removed_at: new Date().toISOString() }).eq("id", v.mediaId);
    expect(await postVideoFor(admin, post)).toBeNull();
    expect((await alice.from("media_files").select("removed_at").eq("id", v.mediaId).single()).data?.removed_at).not.toBeNull();
    // 消したあとの行は、もう片付けの候補にならない
    expect(pick(await candidates(aliceId, soon(30)), v.mediaId)).toBeUndefined();
    // 投稿を消すと添えていない行になり、1 日で行ごと消える
    await alice.from("posts").delete().eq("id", post);
    expect(pick(await candidates(aliceId, soon(1.1)), v.mediaId)).toMatchObject({ mark_removed: false });
  });

  it("cleanupMedia は、添えていない動画のファイルと行を消す（いまの時刻で 1 日たったもの）", async () => {
    const v = await seedPostVideo(admin, { ownerId: bobId, postId: null });
    await admin.from("media_files").update({ created_at: new Date(Date.now() - 2 * DAY).toISOString() }).eq("id", v.mediaId);
    await cleanupMedia(admin, { ownerId: bobId });
    expect((await admin.from("media_files").select("id").eq("id", v.mediaId)).data).toEqual([]);
    expect(await exists(v.path)).toBe(false);
  });
});

describe("postVideoFor（送信ジョブが読む）", () => {
  it("添えた動画の値と、範囲を指定した中身を返す。範囲の外は RangeError。添えていない投稿は null", async () => {
    const post = await newPost();
    const bytes = testMp4({ mdatBytes: 300_000 });
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId: post, bytes, durationMs: 10_000, width: 1080, height: 1920 });
    const pv = await postVideoFor(admin, post);
    expect(pv).toMatchObject({ mediaId: v.mediaId, sizeBytes: bytes.length, mime: "video/mp4", durationMs: 10_000, width: 1080, height: 1920, aiGenerated: false });
    expect(Buffer.from(await pv!.readRange(0, 1000))).toEqual(Buffer.from(bytes.subarray(0, 1000)));
    expect(Buffer.from(await pv!.readRange(1000, bytes.length))).toEqual(Buffer.from(bytes.subarray(1000)));
    await expect(pv!.readRange(0, bytes.length + 1)).rejects.toBeInstanceOf(RangeError);
    await expect(pv!.readRange(10, 10)).rejects.toBeInstanceOf(RangeError);
    expect(await postVideoFor(admin, await newPost())).toBeNull();
  });

  it("Range が効かず全体が返ったら、その中身を持ち、2 回目からは読み直さない", async () => {
    const post = await newPost();
    const bytes = testMp4({ mdatBytes: 10_000 });
    await seedPostVideo(admin, { ownerId: aliceId, postId: post, bytes });
    let calls = 0;
    const whole: typeof fetch = async () => {
      calls += 1;
      return new Response(Buffer.from(bytes), { status: 200 });
    };
    const pv = await postVideoFor(admin, post, { fetch: whole });
    expect(Buffer.from(await pv!.readRange(0, 100))).toEqual(Buffer.from(bytes.subarray(0, 100)));
    expect(Buffer.from(await pv!.readRange(100, 200))).toEqual(Buffer.from(bytes.subarray(100, 200)));
    expect(calls).toBe(1);
  });

  it("ファイルがないときは null", async () => {
    const post = await newPost();
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId: post });
    await admin.storage.from(VIDEO_BUCKET).remove([v.path]);
    expect(await postVideoFor(admin, post)).toBeNull();
  });
});
