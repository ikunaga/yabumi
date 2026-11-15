// 送信ジョブから YouTube に動画を送る通し（docs/design/youtube.md の 3.、docs/design/video.md の 5.）。送信ジョブの動画の受け口（startPublishVideo）→
// continuePublish → published。同意の記録・アップロードの途中の情報・割り当ては本物の DB（このファイルの利用者だけ）、Google と動画は偽物。
// 取り出しは必ず postId を指定し、日時は未来にして pg_cron に拾われないようにする
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { createYouTubeAdapter } from "@/lib/sns/adapters/youtube";
import type { PublishVideo } from "@/lib/sns/adapters/types";
import { publishDueTargets, type PublisherDeps } from "@/lib/sns/publisher";
import { consentHash } from "@/lib/sns/tiktok/send-check";
import { clearYouTubeUpload, loadYouTubeTarget, loadYouTubeUpload, reserveYouTubeUpload, saveYouTubeUpload } from "@/lib/sns/youtube/store";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";
const SIZE = 3 * 1024 * 1024;
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=e2e";
let alice: TestClient;
let aliceId: string;
let projectId: string;
let accountId: string;
const channelId = `UC_${randomUUID()}`;

const video = (): PublishVideo => ({
  url: "https://storage.example/v.mp4",
  mediaId: randomUUID(),
  sizeBytes: SIZE,
  durationMs: 30_000,
  width: 1080,
  height: 1920,
  readRange: async (s, e) => new Uint8Array(e - s),
});

const adapter = createYouTubeAdapter({
  config: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://yabumi.app/sns/youtube/callback" }),
  loadTarget: (id) => loadYouTubeTarget(admin, id),
  loadVideo: async () => ({ ...video(), mime: "video/mp4", aiGenerated: false }),
  reserveUpload: (ownerId, targetId) => reserveYouTubeUpload(admin, ownerId, targetId, { global: 1_000_000, user: 5 }),
  userDailyUploads: 5,
  loadUpload: (id) => loadYouTubeUpload(admin, id, key),
  saveUpload: (id, ownerId, row) => saveYouTubeUpload(admin, id, ownerId, row, new Date(), key),
  clearUpload: (id) => clearYouTubeUpload(admin, id),
});
const deps: PublisherDeps = { adapters: { youtube: adapter }, key, refreshWait: { intervalMs: 50, tries: 40 }, onlyOwner: undefined, loadVideo: async () => video() };

// 偽の Google（Supabase への通信はそのまま通す）。チャンネルは同意したときのもの、アップロードは 1 回で済む
const realFetch = globalThis.fetch;
let received = 0;
let posts = 0;
function fakeGoogle() {
  received = 0;
  posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("googleapis.com")) return realFetch(input, init);
      if (url.includes("/channels")) return new Response(JSON.stringify({ items: [{ id: channelId, snippet: { title: "こむぎのパン" } }] }), { status: 200 });
      if (init?.method === "POST" && url.includes("uploadType=resumable")) {
        posts += 1;
        return new Response(null, { status: 200, headers: { location: SESSION } });
      }
      if (init?.method === "PUT" && url === SESSION) {
        const range = new Headers(init.headers).get("content-range") ?? "";
        if (range.startsWith("bytes */")) return received >= SIZE ? new Response(JSON.stringify({ id: "vid_E2E0001" }), { status: 200 }) : new Response(null, { status: 308 });
        received = Number(/bytes \d+-(\d+)\//.exec(range)![1]) + 1;
        return received >= SIZE ? new Response(JSON.stringify({ id: "vid_E2E0001" }), { status: 201 }) : new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
      }
      return new Response("unexpected", { status: 500 });
    }),
  );
}

async function scheduled(consent = true) {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "説明",
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: [{ sns: "youtube", social_account_id: accountId, title: "新しいパン" }],
  });
  if (error) throw error;
  const targetId = (await admin.from("post_targets").select("id").eq("post_id", postId!).single()).data!.id;
  if (consent) {
    const { error: e2 } = await admin.from("post_target_youtube").insert({
      post_target_id: targetId,
      owner_id: aliceId,
      privacy_status: "unlisted",
      made_for_kids: false,
      synthetic_media: false,
      category_id: "22",
      consented_at: new Date().toISOString(),
      consent_text_hash: consentHash("新しいパン", "説明"),
      consent_channel: "こむぎのパン",
    });
    if (e2) throw e2;
  }
  return { postId: postId!, targetId };
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "YouTube に送る" }).select("id").single()).data!.id;
  accountId = await saveConnectedAccount(
    admin,
    { ownerId: aliceId, sns: "youtube", externalId: channelId, displayName: "こむぎのパン", handle: "komugi", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 3600_000), scopes: [] },
    key,
  );
  await admin.from("project_social_accounts").upsert({ project_id: projectId, social_account_id: accountId, owner_id: aliceId });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await admin.from("sns_api_usage").delete().eq("owner_id", aliceId);
  await deleteUser(aliceId);
});

describe("送信ジョブから YouTube に送る", () => {
  it("動画の受け口で送り、上げ終えたら投稿済み（動画の ID と URL）。割り当てを 1 本使い、途中の情報には動画の ID だけが残る", async () => {
    fakeGoogle();
    const { postId, targetId } = await scheduled();
    const outcomes = await publishDueTargets(admin, deps, { postId });
    expect(outcomes[0]).toMatchObject({ sns: "youtube", result: "published" });
    const t = (await admin.from("post_targets").select("status, external_post_id, external_url").eq("id", targetId).single()).data!;
    expect(t).toEqual({ status: "published", external_post_id: "vid_E2E0001", external_url: "https://www.youtube.com/watch?v=vid_E2E0001" });
    const row = (await admin.from("youtube_uploads").select("video_id, session_uri_encrypted, processing_check_until").eq("post_target_id", targetId).single()).data!;
    expect(row.video_id).toBe("vid_E2E0001");
    expect(row.session_uri_encrypted).toBeNull();
    expect(row.processing_check_until).not.toBeNull();
    expect((await admin.from("sns_api_usage").select("id").eq("post_target_id", targetId).eq("operation", "upload")).data).toHaveLength(1);
    expect(posts).toBe(1);
  });

  it("同意の記録がなければ送らずに失敗にする（割り当ても使わない）", async () => {
    fakeGoogle();
    const { postId, targetId } = await scheduled(false);
    const outcomes = await publishDueTargets(admin, deps, { postId });
    expect(outcomes[0]).toMatchObject({ sns: "youtube", result: "failed" });
    expect((await admin.from("post_targets").select("error_message").eq("id", targetId).single()).data!.error_message).toMatch(/同意してから/);
    expect((await admin.from("sns_api_usage").select("id").eq("post_target_id", targetId)).data).toEqual([]);
    expect(posts).toBe(0);
  });
});
