// 送信ジョブが動画の投稿を送る（docs/design/video.md の 5.）。動画は SNS が取りに来るので、準備中にして次の回に続きを確かめる。
// 動画を送れない SNS には送らない。動画は本物の Storage に置き（seedPostVideo）、SNS には偽のアダプターを使う。取り出しは必ず postId を指定する
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { SNS } from "@/lib/sns";
import { SnsPublishError, type PrepareState, type PublishVideo, type SnsAdapter } from "@/lib/sns/adapters/types";
import { markByHand } from "@/lib/posts/by-hand";
import { removeSentVideo } from "@/lib/media/video-store";
import { publishDueTargets, type PublisherDeps } from "@/lib/sns/publisher";
import { VIDEO_BUCKET } from "@/lib/media/video-rules";
import { cleanupMedia } from "@/lib/media/store";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { seedPostVideo } from "./helpers/video";

vi.mock("server-only", () => ({}));

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";

let alice: TestClient;
let aliceId: string;
let projectId: string;
const accounts: Record<string, string> = {};

function videoAdapter(sns: "threads" | "instagram" | "x", readyAfter = 2): SnsAdapter & { seen: PublishVideo[] } {
  let checks = 0;
  const seen: PublishVideo[] = [];
  return {
    sns,
    seen,
    publishText: vi.fn(async () => ({ externalPostId: "text", url: null })),
    deletePost: vi.fn(async () => {}),
    startPublish: vi.fn(async () => ({ kind: "single", id: "image" }) as PrepareState),
    startPublishVideo: vi.fn(async (_a, _t, video: PublishVideo) => {
      seen.push(video);
      return { kind: "single", id: `c-${randomUUID()}`, video: true } as PrepareState;
    }),
    continuePublish: vi.fn(async (_a, state: PrepareState) => {
      checks += 1;
      return checks >= readyAfter ? { done: { externalPostId: `m-${String(state.id)}`, url: null } } : { state };
    }),
  };
}

async function scheduledPost(sns: Sns): Promise<{ postId: string; targetId: string }> {
  const { postId, targetIds } = await scheduledPostTo([sns]);
  return { postId, targetId: targetIds[sns] };
}

type Sns = "threads" | "instagram" | "x";
async function scheduledPostTo(sns: Sns[]): Promise<{ postId: string; targetIds: Record<string, string> }> {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "動画つき",
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: sns.map((k) => ({ sns: k, social_account_id: accounts[k] })),
  });
  if (error) throw error;
  const { data } = await admin.from("post_targets").select("id, sns").eq("post_id", postId!);
  return { postId: postId!, targetIds: Object.fromEntries((data ?? []).map((t) => [t.sns, t.id])) };
}

const target = async (id: string) => (await admin.from("post_targets").select("*").eq("id", id).single()).data!;
const makeDueNow = (id: string) => admin.from("post_targets").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "動画の送信" }).select("id").single()).data!.id;
  for (const sns of ["threads", "instagram", "x"] as const) {
    accounts[sns] = await saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns, externalId: `${sns}-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date(FUTURE), scopes: ["media.write"] },
      key,
    );
  }
});

afterAll(async () => {
  const { data } = await admin.storage.from(VIDEO_BUCKET).list(aliceId, { limit: 1000 });
  if (data?.length) await admin.storage.from(VIDEO_BUCKET).remove(data.map((f) => `${aliceId}/${f.name}`));
  await deleteUser(aliceId);
});

describe("動画の投稿を送る", () => {
  it("動画を送れる SNS には、署名 URL つきの動画を渡し、準備中にして次の回に公開する。画像の送り方は使わない", async () => {
    const adapter = videoAdapter("threads");
    const loadImages = vi.fn(async () => []);
    const deps: PublisherDeps = { adapters: { threads: adapter }, key, loadImages };
    const { postId, targetId } = await scheduledPost("threads");
    const { mediaId, bytes } = await seedPostVideo(admin, { ownerId: aliceId, postId, durationMs: 30_000 });

    expect((await publishDueTargets(admin, deps, { postId }))[0].result).toBe("preparing");
    expect(adapter.startPublish).not.toHaveBeenCalled();
    expect(loadImages).not.toHaveBeenCalled();
    expect(adapter.seen[0]).toMatchObject({ mediaId, sizeBytes: bytes.length, durationMs: 30_000, width: 1080, height: 1920 });
    expect(adapter.seen[0].url).toContain("/storage/v1/object/sign/post-videos/");
    // SNS が取りに来る URL で、本当に動画が読める
    const fetched = new Uint8Array(await (await fetch(adapter.seen[0].url)).arrayBuffer());
    expect(fetched.length).toBe(bytes.length);
    expect((await target(targetId)).sns_container).toMatchObject({ kind: "single", video: true });

    // 準備中の間は、片付けが動画を消さない
    const { data: cands } = await admin.rpc("cleanup_media_candidates", { p_limit: 100, p_owner_id: aliceId, p_now: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    expect((cands ?? []).some((c) => c.media_id === mediaId)).toBe(false);

    await makeDueNow(targetId);
    expect((await publishDueTargets(admin, deps, { postId }))[0].result).toBe("published");
    expect(adapter.startPublishVideo).toHaveBeenCalledTimes(1);
  });

  // X は 29-5 の W2 の試しの間だけ動画を送れる（2026-11-16 オーナー了承）。その間はこの確かめを飛ばす（trial/x-video-off で戻す）
  it.skipIf(SNS.x.video)("動画を送れない SNS（いまの X）には送らず、外すよう知らせる", async () => {
    const adapter = videoAdapter("x");
    const { postId, targetId } = await scheduledPost("x");
    await seedPostVideo(admin, { ownerId: aliceId, postId });
    const [outcome] = await publishDueTargets(admin, { adapters: { x: adapter }, key }, { postId });
    expect(outcome.result).toBe("failed");
    expect(adapter.startPublishVideo).not.toHaveBeenCalled();
    expect(adapter.publishText).not.toHaveBeenCalled();
    expect((await target(targetId)).error_message).toContain("動画を送れません");
  });

  it("送り終えて消した動画は送らない（文だけで送ってしまわない）", async () => {
    const adapter = videoAdapter("threads", 1);
    const { postId, targetId } = await scheduledPost("threads");
    const { mediaId, path } = await seedPostVideo(admin, { ownerId: aliceId, postId });
    await admin.storage.from(VIDEO_BUCKET).remove([path]);
    await admin.from("media_files").update({ removed_at: new Date().toISOString() }).eq("id", mediaId);
    const [outcome] = await publishDueTargets(admin, { adapters: { threads: adapter }, key }, { postId });
    expect(outcome.result).toBe("failed");
    expect(adapter.publishText).not.toHaveBeenCalled();
    expect((await target(targetId)).error_message).toContain("動画");
  });
});

// 送り終えた動画は、送信ジョブがその場で消す（2026-11-15 オーナーの了承。docs/design/video.md の 7.）。外への通信はない（偽のアダプター）
describe("送り終えたらすぐ消す", () => {
  const exists = async (path: string) => Boolean((await admin.storage.from(VIDEO_BUCKET).download(path)).data);
  const removedAt = async (mediaId: string) => (await admin.from("media_files").select("removed_at").eq("id", mediaId).single()).data!.removed_at;
  const failing = (sns: "instagram"): SnsAdapter => ({
    ...videoAdapter(sns, 1),
    startPublishVideo: vi.fn(async () => {
      throw new SnsPublishError("permanent", "送れませんでした（テスト）");
    }),
  });

  it("すべての配信先に送り終えたら、その場でファイルを消して removed_at を入れる。他の投稿の動画は消さない", async () => {
    const other = await scheduledPost("threads");
    const otherVideo = await seedPostVideo(admin, { ownerId: aliceId, postId: other.postId });
    const { postId, targetIds } = await scheduledPostTo(["threads", "instagram"]);
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId });

    const deps: PublisherDeps = { adapters: { threads: videoAdapter("threads", 1), instagram: videoAdapter("instagram", 1) }, key };
    const outcomes = await publishDueTargets(admin, deps, { postId });
    expect(outcomes.map((o) => o.result)).toEqual(["published", "published"]);
    expect((await target(targetIds.threads)).status).toBe("published");
    expect(await removedAt(v.mediaId)).not.toBeNull();
    expect(await exists(v.path)).toBe(false);
    // 利用者の権限でも「消した」が読める（保存の「動画を選び直して」はこれで止める。src/lib/posts/actions.ts）
    expect((await alice.from("media_files").select("id").eq("post_id", postId).eq("kind", "video").not("removed_at", "is", null)).data).toHaveLength(1);
    // 他の投稿（まだ送っていない）の動画はそのまま
    expect(await removedAt(otherVideo.mediaId)).toBeNull();
    expect(await exists(otherVideo.path)).toBe(true);
  });

  it("準備中の配信先が残る間は消さず、最後の配信先を送り終えた回に消す", async () => {
    const { postId } = await scheduledPostTo(["threads", "instagram"]);
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId });
    const deps: PublisherDeps = { adapters: { threads: videoAdapter("threads", 1), instagram: videoAdapter("instagram", 2) }, key };
    expect((await publishDueTargets(admin, deps, { postId })).map((o) => o.result).sort()).toEqual(["preparing", "published"]);
    expect(await removedAt(v.mediaId)).toBeNull();
    expect(await exists(v.path)).toBe(true);
    await admin.from("post_targets").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("post_id", postId).eq("status", "preparing");
    expect((await publishDueTargets(admin, deps, { postId })).map((o) => o.result)).toEqual(["published"]);
    expect(await removedAt(v.mediaId)).not.toBeNull();
    expect(await exists(v.path)).toBe(false);
  });

  it("送れなかった配信先が残ると消さない（送り直せる）。片付けは最後の更新から 7 日で消す", async () => {
    const { postId, targetIds } = await scheduledPostTo(["threads", "instagram"]);
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId });
    const deps: PublisherDeps = { adapters: { threads: videoAdapter("threads", 1), instagram: failing("instagram") }, key };
    expect((await publishDueTargets(admin, deps, { postId })).map((o) => o.result).sort()).toEqual(["failed", "published"]);
    expect((await target(targetIds.instagram)).status).toBe("failed");
    expect(await removedAt(v.mediaId)).toBeNull();
    expect(await exists(v.path)).toBe(true);
    expect(await removeSentVideo(admin, postId)).toBe(false);
    const cands = async (days: number) =>
      (await admin.rpc("cleanup_media_candidates", { p_limit: 100, p_owner_id: aliceId, p_now: new Date(Date.now() + days * 86_400_000).toISOString() })).data ?? [];
    expect((await cands(6)).some((c) => c.media_id === v.mediaId)).toBe(false);
    expect((await cands(8)).find((c) => c.media_id === v.mediaId)).toMatchObject({ mark_removed: true });
  });

  it("「手動で投稿する」の配信先が残る間は消さず（手元に落とせる）、手動で投稿したと記録したら消す", async () => {
    const { postId, targetIds } = await scheduledPostTo(["threads", "x"]);
    expect(await markByHand(admin, postId, aliceId, "x")).toEqual({ ok: true });
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId });
    expect((await publishDueTargets(admin, { adapters: { threads: videoAdapter("threads", 1) }, key }, { postId })).map((o) => o.result)).toEqual(["published"]);
    expect(await removedAt(v.mediaId)).toBeNull();
    expect(await exists(v.path)).toBe(true);
    // 手で投稿したと記録する（src/lib/posts/send-actions.ts の markManualPosted と同じ順: 利用者の権限で記録してから消す）
    const { error } = await alice.rpc("mark_manual_target_posted", { p_target_id: targetIds.x, p_url: "" });
    expect(error).toBeNull();
    expect(await removeSentVideo(admin, postId)).toBe(true);
    expect(await removedAt(v.mediaId)).not.toBeNull();
    expect(await exists(v.path)).toBe(false);
    // 2 回目は何もしない（消した時刻も変えない）
    const at = await removedAt(v.mediaId);
    expect(await removeSentVideo(admin, postId)).toBe(false);
    expect(await removedAt(v.mediaId)).toBe(at);
  });

  it("消したあとに配信先を足して送り直すと、文だけでは送らず「動画を選び直して」で止まる", async () => {
    const { postId } = await scheduledPost("threads");
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId });
    const threads = videoAdapter("threads", 1);
    await publishDueTargets(admin, { adapters: { threads }, key }, { postId });
    expect(await removedAt(v.mediaId)).not.toBeNull();
    // 送り先を足す（保存の save_post と同じく、送信待ちの配信先が増える）
    const { data: added, error } = await admin
      .from("post_targets")
      .insert({ post_id: postId, owner_id: aliceId, sns: "instagram", social_account_id: accounts.instagram, status: "pending", next_attempt_at: new Date(Date.now() - 1000).toISOString() })
      .select("id")
      .single();
    expect(error).toBeNull();
    const instagram = videoAdapter("instagram", 1);
    const [outcome] = await publishDueTargets(admin, { adapters: { instagram }, key }, { postId });
    expect(outcome.result).toBe("failed");
    expect(instagram.publishText).not.toHaveBeenCalled();
    expect(instagram.startPublishVideo).not.toHaveBeenCalled();
    expect((await target(added!.id)).error_message).toContain("動画を選び直して");
  });

  it("removed_at を入れたのにファイルが残っていたら（消しそこね）、片付けがファイルを消し、消した時刻は変えない", async () => {
    const { postId } = await scheduledPost("threads");
    const v = await seedPostVideo(admin, { ownerId: aliceId, postId });
    await admin.from("post_targets").update({ status: "published" }).eq("post_id", postId);
    const at = new Date(Date.now() - 3_600_000).toISOString();
    await admin.from("media_files").update({ removed_at: at }).eq("id", v.mediaId);
    const { data } = await admin.rpc("cleanup_media_candidates", { p_limit: 100, p_owner_id: aliceId });
    expect((data ?? []).find((c) => c.media_id === v.mediaId)).toMatchObject({ bucket: VIDEO_BUCKET, storage_path: v.path, mark_removed: true });
    await cleanupMedia(admin, { ownerId: aliceId });
    expect(await exists(v.path)).toBe(false);
    expect(new Date((await removedAt(v.mediaId))!).toISOString()).toBe(at);
    // ファイルがなくなれば、もう候補にならない
    expect(((await admin.rpc("cleanup_media_candidates", { p_limit: 100, p_owner_id: aliceId })).data ?? []).some((c) => c.media_id === v.mediaId)).toBe(false);
  });
});
