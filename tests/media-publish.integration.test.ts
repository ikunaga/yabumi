// 送信ジョブが投稿の画像を読んでアダプターに渡すこと（docs/architecture.md の 4.18）。
// SNS には偽のアダプターを使う。取り出しは必ず postId を指定し、ほかの予約に触れない
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { attachMedia, issueUpload, verifyUpload } from "@/lib/media/store";
import { saveConnectedAccount } from "@/lib/sns/accounts";
import type { PublishImage, SnsAdapter } from "@/lib/sns/adapters/types";
import { publishDueTargets } from "@/lib/sns/publisher";
import { testJpeg } from "./helpers/jpeg";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const key = randomBytes(32);
const admin = adminClient();
const FUTURE = "2099-01-01T00:00:00Z";

let alice: TestClient;
let aliceId: string;
let projectId: string;
const accounts: Record<string, string> = {};

function fakeAdapter(sns: "threads" | "x"): SnsAdapter {
  return {
    sns,
    publishText: vi.fn(async () => ({ externalPostId: `m-${randomUUID()}`, url: null })),
    deletePost: vi.fn(async () => {}),
    ...(sns === "x" ? { publishCost: () => ({ operation: "post" as const, costUsd: 0 }) } : {}),
  };
}

async function upload(altText: string) {
  const ticket = await issueUpload(admin, aliceId);
  await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg()), headers: { "Content-Type": "image/jpeg" } });
  const file = await verifyUpload(admin, aliceId, ticket.path);
  return { id: file.id, altText };
}

async function scheduledPostWithImages(sns: "threads" | "x", count: number) {
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "画像つき",
    p_planned_at: FUTURE,
    p_status: "scheduled",
    p_targets: [{ sns, social_account_id: accounts[sns] }],
  });
  if (error) throw error;
  const items = [];
  for (let i = 0; i < count; i++) items.push(await upload(i === 0 ? "1 枚目" : ""));
  await attachMedia(admin, aliceId, postId!, items);
  return postId!;
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "画像の送信" }).select("id").single()).data!.id;
  for (const [sns, scopes] of [
    ["threads", ["threads_basic", "threads_content_publish"]],
    // media.write を足す前につないだ X
    ["x", ["tweet.read", "tweet.write", "users.read", "offline.access"]],
  ] as const) {
    accounts[sns] = await saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns, externalId: `${sns}-${randomUUID()}`, displayName: "A", handle: "a", accessToken: "t", expiresAt: new Date(FUTURE), scopes },
      key,
    );
  }
});

afterAll(async () => {
  const { data } = await admin.storage.from(MEDIA_BUCKET).list(aliceId, { limit: 1000 });
  if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${aliceId}/${f.name}`));
  await deleteUser(aliceId);
});

describe("画像つきの送信", () => {
  it("並び順の画像（期限つきの URL・代わりの文・中身）をアダプターに渡す", async () => {
    const postId = await scheduledPostWithImages("threads", 2);
    const threads = fakeAdapter("threads");
    const [o] = await publishDueTargets(admin, { adapters: { threads }, key }, { postId });
    expect(o.result).toBe("published");
    const images = vi.mocked(threads.publishText).mock.calls[0][2] as PublishImage[];
    expect(images.map((i) => i.altText)).toEqual(["1 枚目", ""]);
    expect(images[0].url).toContain("token=");
    expect((await fetch(images[0].url)).ok).toBe(true);
    expect([...(await images[1].load()).subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it("X で media.write がないアカウントは、送らずに（費用も記録せず）つなぎ直しを案内する", async () => {
    const postId = await scheduledPostWithImages("x", 1);
    const x = fakeAdapter("x");
    const [o] = await publishDueTargets(admin, { adapters: { x }, key }, { postId });
    expect(o.result).toBe("failed");
    expect(o.message).toContain("つなぎ直し");
    expect(x.publishText).not.toHaveBeenCalled();
    const { data: target } = await admin.from("post_targets").select("id").eq("post_id", postId).single();
    expect((await admin.from("sns_api_usage").select("id").eq("post_target_id", target!.id)).data).toEqual([]);
  });

  it("X の上限（4 枚）を超えていたら送らない", async () => {
    await admin.from("social_account_tokens").update({ scopes: ["tweet.write", "media.write"] }).eq("social_account_id", accounts.x);
    const postId = await scheduledPostWithImages("x", 5);
    const x = fakeAdapter("x");
    const [o] = await publishDueTargets(admin, { adapters: { x }, key }, { postId });
    expect(o.result).toBe("failed");
    expect(o.message).toContain("4 枚まで");
    expect(x.publishText).not.toHaveBeenCalled();
  });
});
