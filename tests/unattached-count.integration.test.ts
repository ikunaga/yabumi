// 画像の欄の「保存していない画像 18/20」の数（4.63）。上限の確かめ（issue_media_upload_ticket）と同じ数え方であること
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_UNATTACHED, MEDIA_BUCKET, USER_QUOTA_BYTES, unattachedLimitMessage } from "@/lib/media/rules";
import { MAX_PENDING_TICKETS, attachMedia, issueUpload, unattachedCount, verifyUpload } from "@/lib/media/store";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let bobId: string;

async function upload(ownerId: string) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await fetch(ticket.signedUrl, { method: "PUT", body: Buffer.from(testJpeg()), headers: { "Content-Type": "image/jpeg", "x-upsert": "false" } });
  expect(res.ok).toBe(true);
  return (await verifyUpload(admin, ownerId, ticket.path)).id;
}

// 上限を max にしたときに、上限の確かめが上げさせるか（引換券は作ったら消す）
async function allowedWith(max: number) {
  const path = `${aliceId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await admin.rpc("issue_media_upload_ticket", {
    p_owner_id: aliceId,
    p_storage_path: path,
    p_max_pending: MAX_PENDING_TICKETS,
    p_max_unattached: max,
    p_quota_bytes: USER_QUOTA_BYTES,
    p_max_file_bytes: MAX_IMAGE_BYTES,
  });
  if (error) throw error;
  await admin.from("media_upload_tickets").delete().eq("storage_path", path);
  return data !== "too_many_unattached";
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  const projectId = (await alice.from("projects").insert({ name: "数" }).select("id").single()).data!.id;
  const { data: postId, error } = await alice.rpc("save_post", {
    p_post_id: null as unknown as string,
    p_project_id: projectId,
    p_body: "数える",
    p_planned_at: null as unknown as string,
    p_status: "draft",
    p_targets: [{ sns: "threads" }],
  });
  if (error) throw error;
  await upload(aliceId);
  await upload(aliceId);
  const attached = await upload(aliceId);
  await attachMedia(admin, aliceId, postId!, [{ id: attached, altText: "" }]);
  await upload(bobId);
  // 確かめ待ちの引換券も数える（上げている途中の分）
  await issueUpload(admin, aliceId);
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("保存していない画像の数", () => {
  it("添えていない画像と確かめ待ちの引換券を数える（添えた画像・ほかの人の画像は数えない）", async () => {
    expect(await unattachedCount(admin, aliceId)).toBe(3);
  });
  it("上限の確かめと同じ数え方（数と同じ上限なら上げられず、1 つ多ければ上げられる）", async () => {
    const n = await unattachedCount(admin, aliceId);
    expect(await allowedWith(n)).toBe(false);
    expect(await allowedWith(n + 1)).toBe(true);
  });
  it("上限に達したときの言葉に、ほかの書きかけの分も数えること・この画面で外すこと・1 日で消えることを書く", () => {
    const m = unattachedLimitMessage();
    expect(m).toContain(`${MAX_UNATTACHED} 枚`);
    expect(m).toContain("ほかの書きかけの分も数えます");
    expect(m).toContain("この画面の要らない画像を外して");
    expect(m).toContain("1 日で消えます");
  });
});
