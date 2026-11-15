// 送信ジョブが動画の投稿を送る（docs/design/video.md の 5.）。動画は SNS が取りに来るので、準備中にして次の回に続きを確かめる。
// 動画を送れない SNS には送らない。動画は本物の Storage に置き（seedPostVideo）、SNS には偽のアダプターを使う。取り出しは必ず postId を指定する
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { PrepareState, PublishVideo, SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets, type PublisherDeps } from "@/lib/sns/publisher";
import { VIDEO_BUCKET } from "@/lib/media/video-rules";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { seedPostVideo } from "./helpers/video";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";

let alice: TestClient;
let aliceId: string;
let projectId: string;
const accounts: Record<string, string> = {};

function videoAdapter(sns: "threads" | "x", readyAfter = 2): SnsAdapter & { seen: PublishVideo[] } {
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

async function scheduledPost(sns: "threads" | "x"): Promise<{ postId: string; targetId: string }> {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "動画つき",
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: [{ sns, social_account_id: accounts[sns] }],
  });
  if (error) throw error;
  const { data } = await admin.from("post_targets").select("id").eq("post_id", postId!).single();
  return { postId: postId!, targetId: data!.id };
}

const target = async (id: string) => (await admin.from("post_targets").select("*").eq("id", id).single()).data!;
const makeDueNow = (id: string) => admin.from("post_targets").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "動画の送信" }).select("id").single()).data!.id;
  for (const sns of ["threads", "x"] as const) {
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

  it("動画を送れない SNS（いまの X）には送らず、外すよう知らせる", async () => {
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
