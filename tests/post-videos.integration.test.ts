// 投稿に添える動画（docs/design/video.md の 3.・6.・7.）。ローカルの Supabase Storage に TUS で本当に上げて確かめる。
// 他人の動画を読めない・上げられない、上限、1 投稿に動画 1 本・画像と混ぜない、画像の数え方、片付け（preparing の間は消さない）、postVideoFor。
// 片付けは、テストの利用者の分だけに絞って呼ぶ（ローカル DB のほかの人のファイルを消さないため）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { MediaError, attachMedia, cleanupMedia, issueUpload, unattachedCount, verifyUpload } from "@/lib/media/store";
import { attachVideo, cancelVideoUpload, checkVideoUpload, discardUnattachedVideo, issueVideoUpload, postVideoFor, verifyVideoUpload } from "@/lib/media/video-store";
import { MAX_PENDING_VIDEO_TICKETS, MAX_UNATTACHED_VIDEOS, MAX_VIDEO_BYTES, VIDEO_BUCKET, VIDEO_GLOBAL_QUOTA_BYTES, VIDEO_MONTH_LIMIT, VIDEO_USER_QUOTA_BYTES, videoPath } from "@/lib/media/video-rules";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { putImage } from "./helpers/upload";
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
  expect(await tusUpload({ path: ticket.path, bytes })).toBe(204);
  return verifyVideoUpload(admin, ownerId, ticket.path);
}

async function uploadImage(ownerId: string) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await putImage(ticket.path, testJpeg());
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

  it("形が合わない動画は受け付けず、ファイルを消して引換券に使った印を付ける。その場所には、もう上げられない", async () => {
    const ticket = await issueVideoUpload(admin, aliceId);
    expect(await tusUpload({ path: ticket.path, bytes: testMp4({ moovAfterMdat: true }) })).toBe(204);
    await expect(verifyVideoUpload(admin, aliceId, ticket.path)).rejects.toBeInstanceOf(MediaError);
    expect(await exists(ticket.path)).toBe(false);
    expect((await admin.from("media_upload_tickets").select("consumed_at").eq("storage_path", ticket.path).single()).data?.consumed_at).not.toBeNull();
    expect((await admin.from("media_files").select("id").eq("storage_path", ticket.path)).data).toEqual([]);
    expect(await tusUpload({ path: ticket.path, bytes: testMp4() })).toBe(403);
    expect(await exists(ticket.path)).toBe(false);
    await clearTickets(aliceId);
  });

  it("確かめを通った動画は、同じ場所に上げ直して差し替えられない（上書きは断る）。0 バイトは確かめで落ちる", async () => {
    const v = await uploadVideo(aliceId);
    const evil = testMp4({ mdatBytes: 5000, udta: true });
    expect(await tusUpload({ path: v.storagePath, bytes: evil })).not.toBe(204);
    expect(await tusUpload({ path: v.storagePath, bytes: evil, upsert: true })).not.toBe(204);
    const { data: stored } = await admin.storage.from(VIDEO_BUCKET).download(v.storagePath);
    expect(stored!.size).toBe(v.sizeBytes);
    await discardUnattachedVideo(admin, aliceId, v.id);

    const empty = await issueVideoUpload(admin, aliceId);
    await tusUpload({ path: empty.path, bytes: new Uint8Array(0) });
    await expect(verifyVideoUpload(admin, aliceId, empty.path)).rejects.toBeInstanceOf(MediaError);
    await clearTickets(aliceId);
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

  it("利用者のログインのまま上げられるのは、本人の・まだ使っていない・2 時間以内の動画の引換券がある場所だけ", async () => {
    // 引換券のない場所・画像のバケット・他人のフォルダ（他人の引換券）・期限切れの引換券には上げられない
    expect(await tusUpload({ path: videoPath(aliceId, crypto.randomUUID()), bytes: testMp4() })).toBe(403);
    const ticket = await issueVideoUpload(admin, aliceId);
    expect(await tusUpload({ path: ticket.path, bytes: testMp4(), bucket: MEDIA_BUCKET })).not.toBe(204);
    expect(await tusUpload({ path: ticket.path, bytes: testMp4(), as: bobId })).toBe(403);
    await admin.from("media_upload_tickets").update({ created_at: new Date(Date.now() - 3 * 3600_000).toISOString() }).eq("storage_path", ticket.path);
    expect(await tusUpload({ path: ticket.path, bytes: testMp4() })).toBe(403);
    expect(await exists(ticket.path)).toBe(false);
    // 画像の引換券の場所に、動画のバケットとして上げることもできない
    const img = await issueUpload(admin, aliceId);
    expect(await tusUpload({ path: img.path.replace(/\.jpg$/, ".mp4"), bytes: testMp4() })).toBe(403);
    await clearTickets(aliceId);
  });

  it("判定の関数は、authenticated だけが呼べ（ポリシーから使う）、本人の引換券しか見ない", async () => {
    const ticket = await issueVideoUpload(admin, aliceId);
    expect((await alice.rpc("storage_upload_allowed", { p_bucket: VIDEO_BUCKET, p_name: ticket.path })).data).toBe(true);
    expect((await bob.rpc("storage_upload_allowed", { p_bucket: VIDEO_BUCKET, p_name: ticket.path })).data).toBe(false);
    expect((await anonClient().rpc("storage_upload_allowed", { p_bucket: VIDEO_BUCKET, p_name: ticket.path })).error?.code).toBe("42501");
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
    const args = { p_owner_id: aliceId, p_storage_path: fake.storage_path };
    expect((await alice.rpc("issue_video_upload_ticket", args)).error?.code).toBe("42501");
    expect((await anonClient().rpc("issue_video_upload_ticket", args)).error?.code).toBe("42501");
    expect((await alice.rpc("cleanup_media_candidates", {})).error?.code).toBe("42501");
  });
});

describe("やめる（2026-11-15 PMO の確かめ v15）", () => {
  // 利用者ごとの、確かめ待ち・量・月の本数（video_upload_check と同じ数え方で、上限ぎりぎりの値を渡して見る）
  const month = async (ownerId: string) => {
    const { data } = await admin.from("video_upload_counts").select("count").eq("owner_id", ownerId);
    return (data ?? []).reduce((n, r) => n + r.count, 0);
  };
  // 上限は関数の中の定数（20261117140000）。全体の量は、その利用者の分だけで数える（共有の DB のほかのテストに左右されない）
  const check = (ownerId: string) => admin.rpc("video_upload_check", { p_owner_id: ownerId, p_scope_owner: ownerId });
  // 量の上限に近づけるための、ファイルのない動画の記録（添えていない 1 本に数える。終わったら消す）
  const filler = async (ownerId: string, bytes: number) => {
    const { data, error } = await admin
      .from("media_files")
      .insert({ owner_id: ownerId, post_id: null, storage_path: videoPath(ownerId, crypto.randomUUID()), kind: "video", duration_ms: 1000, width: 1080, height: 1920, size_bytes: bytes })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  };

  it("上げ終えたあとにやめると、引換券に印を付けてファイルを消し、確かめ待ち・量・月の本数が元に戻る（その引換券ではもう確かめない）", async () => {
    const { userId } = await signUpNewUser();
    try {
      const before = await month(userId);
      const ticket = await issueVideoUpload(admin, userId);
      expect(await tusUpload({ path: ticket.path, bytes: testMp4() })).toBe(204);
      // やめる前: 確かめ待ちが 1 本で、量に 50MB を見込む（置ける量の残りがちょうど 2 本分に 1 バイト足りない記録を置くと、量に当たる）
      const fill = await filler(userId, VIDEO_USER_QUOTA_BYTES - MAX_VIDEO_BYTES * 2 + 1);
      expect((await check(userId)).data).toBe("quota");
      await admin.from("media_files").delete().eq("id", fill);
      // 確かめ待ちがもう 1 本あると、上限（2 本）に当たる
      const second = await issueVideoUpload(admin, userId);
      expect((await check(userId)).data).toBe("too_many_pending");

      await cancelVideoUpload(admin, userId, ticket.path);
      expect(await exists(ticket.path)).toBe(false);
      // やめたあと: 確かめ待ちは 1 本に戻り、量も 50MB 分戻る（同じ記録を置いても量に当たらない）
      expect((await check(userId)).data).toBe("ok");
      await cancelVideoUpload(admin, userId, second.path);
      const fill2 = await filler(userId, VIDEO_USER_QUOTA_BYTES - MAX_VIDEO_BYTES * 2 + 1);
      expect((await check(userId)).data).toBe("ok");
      await admin.from("media_files").delete().eq("id", fill2);
      // ファイルのない記録も、足したときに月の本数に数えられる（トリガー）ので、その 2 本を引いてから比べる
      expect(await month(userId)).toBe(before + 2);
      await expect(verifyVideoUpload(admin, userId, ticket.path)).rejects.toBeInstanceOf(MediaError);

      // やめた場所には、新しく上げ始められない
      expect(await tusUpload({ path: ticket.path, bytes: testMp4() })).toBe(403);
      expect(await exists(ticket.path)).toBe(false);
      const midway = await issueVideoUpload(admin, userId);
      await cancelVideoUpload(admin, userId, midway.path);
      expect(await tusUpload({ path: midway.path, bytes: testMp4({ mdatBytes: 7 * 1024 * 1024 }) })).toBe(403);
      expect(await exists(midway.path)).toBe(false);
    } finally {
      await admin.from("media_upload_tickets").delete().eq("owner_id", userId);
      await deleteUser(userId);
    }
  });

  it("やめて印を付けたあとに最後の書き込みが届いてファイルができても、次の上限の確かめ・発行・やめるで消え、量に数えられない（PMO の再確認）", async () => {
    const { userId } = await signUpNewUser();
    try {
      const ticket = await issueVideoUpload(admin, userId);
      await cancelVideoUpload(admin, userId, ticket.path);
      // 印のあとに最後の書き込みが届いた形を作る（作ってあった TUS の最後の 1 本。ポリシーは TUS を作るときにしか効かない）
      const late = testMp4({ mdatBytes: 300_000 });
      const { error: lateError } = await admin.storage.from(VIDEO_BUCKET).upload(ticket.path, late, { contentType: "video/mp4" });
      expect(lateError).toBeNull();
      expect(await exists(ticket.path)).toBe(true);
      // そのままだと量に数えられる（実際の大きさで）。残りがちょうど late の分だけ足りない記録を置いて見る
      const fill = await filler(userId, VIDEO_USER_QUOTA_BYTES - MAX_VIDEO_BYTES - late.length + 1);
      expect((await check(userId)).data).toBe("quota");
      // 次の上限の確かめ（画面が整える前に呼ぶ）で消え、数えられない
      await checkVideoUpload(admin, userId);
      expect(await exists(ticket.path)).toBe(false);
      expect((await check(userId)).data).toBe("ok");
      await admin.from("media_files").delete().eq("id", fill);
      // 発行の前・やめるのあとでも消える
      await admin.storage.from(VIDEO_BUCKET).upload(ticket.path, late, { contentType: "video/mp4" });
      const next = await issueVideoUpload(admin, userId);
      expect(await exists(ticket.path)).toBe(false);
      await admin.storage.from(VIDEO_BUCKET).upload(ticket.path, late, { contentType: "video/mp4" });
      await cancelVideoUpload(admin, userId, next.path);
      expect(await exists(ticket.path)).toBe(false);
    } finally {
      await admin.from("media_upload_tickets").delete().eq("owner_id", userId);
      await deleteUser(userId);
    }
  });

  it("1 枚の引換券で置けるのは 1 本だけ（上げ終えた場所にもう一度・別の名前には上げられない）。確かめを通った動画は片付けで消さない", async () => {
    const { userId } = await signUpNewUser();
    try {
      const ticket = await issueVideoUpload(admin, userId);
      expect(await tusUpload({ path: ticket.path, bytes: testMp4() })).toBe(204);
      expect(await tusUpload({ path: ticket.path, bytes: testMp4({ mdatBytes: 999 }) })).toBe(409);
      expect(await tusUpload({ path: ticket.path, bytes: testMp4({ mdatBytes: 999 }), upsert: true })).toBe(403);
      expect(await tusUpload({ path: videoPath(userId, crypto.randomUUID()), bytes: testMp4() })).toBe(403);
      const v = await verifyVideoUpload(admin, userId, ticket.path);
      await checkVideoUpload(admin, userId);
      expect(await exists(v.storagePath)).toBe(true);
    } finally {
      const files = (await admin.storage.from(VIDEO_BUCKET).list(userId)).data ?? [];
      if (files.length) await admin.storage.from(VIDEO_BUCKET).remove(files.map((o) => `${userId}/${o.name}`));
      await admin.from("media_upload_tickets").delete().eq("owner_id", userId);
      await deleteUser(userId);
    }
  });

  it("確かめを通ったあとにやめると、まだ添えていなければ動画を外す。月の本数は確かめを通った動画だけを数える", async () => {
    const { userId } = await signUpNewUser();
    try {
      const before = await month(userId);
      const v = await uploadVideo(userId);
      expect(await month(userId)).toBe(before + 1);
      await cancelVideoUpload(admin, userId, v.storagePath);
      expect((await admin.from("media_files").select("id").eq("id", v.id)).data).toEqual([]);
      expect(await exists(v.storagePath)).toBe(false);
      // 断った動画は数えない
      const ticket = await issueVideoUpload(admin, userId);
      expect(await tusUpload({ path: ticket.path, bytes: testMp4({ udta: true }) })).toBe(204);
      await expect(verifyVideoUpload(admin, userId, ticket.path)).rejects.toBeInstanceOf(MediaError);
      expect(await month(userId)).toBe(before + 1);
      // 他人の引換券・投稿に添えた動画は片付けない
      const other = await issueVideoUpload(admin, bobId);
      await cancelVideoUpload(admin, userId, other.path);
      expect((await admin.from("media_upload_tickets").select("consumed_at").eq("storage_path", other.path).single()).data?.consumed_at).toBeNull();
      await clearTickets(bobId);
    } finally {
      await admin.from("media_upload_tickets").delete().eq("owner_id", userId);
      await admin.from("video_upload_counts").delete().eq("owner_id", userId);
      await deleteUser(userId);
    }
  });

  it("整える前の確かめ（checkVideoUpload）は、上限に当たっていれば文で知らせ、引換券は出さない", async () => {
    const { userId } = await signUpNewUser();
    try {
      await checkVideoUpload(admin, userId);
      const month0 = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
      const monthKey = `${month0.getFullYear()}-${String(month0.getMonth() + 1).padStart(2, "0")}-01`;
      await admin.from("video_upload_counts").insert({ owner_id: userId, month: monthKey, count: 20 });
      await expect(checkVideoUpload(admin, userId)).rejects.toMatchObject({ userMessage: expect.stringContaining("1 か月に 20 本") });
      expect((await admin.from("media_upload_tickets").select("storage_path").eq("owner_id", userId)).data).toEqual([]);
    } finally {
      await admin.from("video_upload_counts").delete().eq("owner_id", userId);
      await deleteUser(userId);
    }
  });

  it("引換券の関数（video_upload_check も）を、authenticated・anon は呼べない", async () => {
    const args = { p_owner_id: aliceId };
    expect((await alice.rpc("video_upload_check", args)).error?.code).toBe("42501");
    expect((await anonClient().rpc("video_upload_check", args)).error?.code).toBe("42501");
  });
});

describe("上限", () => {
  // 上限は関数の中の定数（20261117140000）。全体の量は scope の利用者の分だけで数える（既定は bob 自身）
  const call = (o: Partial<{ scope: string; path: string }> = {}) =>
    admin.rpc("issue_video_upload_ticket", { p_owner_id: bobId, p_storage_path: o.path ?? videoPath(bobId, crypto.randomUUID()), p_scope_owner: o.scope ?? bobId });
  const fillerRow = (ownerId: string, bytes: number) => ({ owner_id: ownerId, post_id: null, storage_path: videoPath(ownerId, crypto.randomUUID()), kind: "video", duration_ms: 1000, width: 1080, height: 1920, size_bytes: bytes });

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
    const seeded = await Promise.all(Array.from({ length: MAX_UNATTACHED_VIDEOS }, () => seedPostVideo(admin, { ownerId: bobId, postId: null })));
    expect((await call()).data).toBe("too_many_unattached");
    await admin.from("media_files").delete().in("id", seeded.map((s) => s.mediaId));
    await admin.storage.from(VIDEO_BUCKET).remove(seeded.map((s) => s.path));
    // 置ける量: 残りが 1 本分に 1 バイト足りない（ファイルのない記録で量だけ置く）
    const { data: fill } = await admin.from("media_files").insert(fillerRow(bobId, VIDEO_USER_QUOTA_BYTES - MAX_VIDEO_BYTES + 1)).select("id").single();
    expect((await call()).data).toBe("quota");
    await admin.from("media_files").delete().eq("id", fill!.id);
    // 全体の量: 別の利用者（carol）の分だけで数え、残りが 1 本分に 1 バイト足りない
    const { userId: carolId } = await signUpNewUser();
    try {
      expect((await admin.from("media_files").insert(fillerRow(carolId, VIDEO_GLOBAL_QUOTA_BYTES - MAX_VIDEO_BYTES + 1))).error).toBeNull();
      expect((await call({ scope: carolId })).data).toBe("global_quota");
    } finally {
      await admin.from("media_files").delete().eq("owner_id", carolId);
      await admin.from("video_upload_counts").delete().eq("owner_id", carolId);
      await deleteUser(carolId);
    }
    // 月の本数: 今月の数が上限に達している
    const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7) + "-01";
    const { data: counted } = await admin.from("video_upload_counts").select("count").eq("owner_id", bobId).eq("month", month).maybeSingle();
    await admin.from("video_upload_counts").upsert({ owner_id: bobId, month, count: VIDEO_MONTH_LIMIT }, { onConflict: "owner_id,month" });
    expect((await call()).data).toBe("month_limit");
    await admin.from("video_upload_counts").upsert({ owner_id: bobId, month, count: counted?.count ?? 0 }, { onConflict: "owner_id,month" });
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

  it("送り終えて消した動画の印は、外すだけでは残る（文だけで送らないため）。画像を添えるとき・別の動画に入れ替えるときは外れる", async () => {
    const post = await newPost();
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId: post });
    await admin.storage.from(VIDEO_BUCKET).remove([v.path]);
    await admin.from("media_files").update({ removed_at: new Date().toISOString() }).eq("id", v.mediaId);
    await attachVideo(admin, aliceId, post, null);
    expect((await admin.from("media_files").select("id").eq("id", v.mediaId)).data).toHaveLength(1);
    await attachVideo(admin, aliceId, post, null, { keepRemoved: false });
    expect((await admin.from("media_files").select("id").eq("id", v.mediaId)).data).toEqual([]);
    const img = await uploadImage(aliceId);
    await attachMedia(admin, aliceId, post, [{ id: img.id, altText: "" }]);

    const post2 = await newPost();
    const old = await seedPostVideo(admin, { ownerId: aliceId, postId: post2 });
    await admin.from("media_files").update({ removed_at: new Date().toISOString() }).eq("id", old.mediaId);
    const next = await seedPostVideo(admin, { ownerId: aliceId, postId: null });
    await attachVideo(admin, aliceId, post2, next.mediaId);
    expect((await admin.from("media_files").select("id").eq("post_id", post2)).data).toEqual([{ id: next.mediaId }]);
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

  it("送り終えた動画は待たずに（ふだんは送信ジョブがその場で消す。ここは取りこぼしの受け皿）、送れなかった配信先が残れば 7 日。下書き（配信先が pending）・preparing・publishing の間は消さない", async () => {
    const sent = await sentPost(["published", "published"]);
    const failed = await sentPost(["published", "failed"]);
    const preparing = await sentPost(["published", "preparing"]);
    const publishing = await sentPost(["publishing"]);
    const draft = await sentPost(["pending"]);
    const v = Object.fromEntries(
      await Promise.all(Object.entries({ sent, failed, preparing, publishing, draft }).map(async ([k, post]) => [k, (await seedPostVideo(admin, { ownerId: aliceId, postId: post })).mediaId] as const)),
    );
    const day0 = await candidates(aliceId, soon(0));
    expect(pick(day0, v.sent)).toMatchObject({ bucket: VIDEO_BUCKET, mark_removed: true });
    for (const k of ["failed", "preparing", "publishing", "draft"]) expect(pick(day0, v[k])).toBeUndefined();
    const day6 = await candidates(aliceId, soon(6));
    expect(pick(day6, v.failed)).toBeUndefined();
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
