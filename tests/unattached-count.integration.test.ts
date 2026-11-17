// 画像の欄の「保存していない画像 18/20」の数（4.63）。上限の確かめ（issue_media_upload_ticket）と同じ数え方であること
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_UNATTACHED, MEDIA_BUCKET, unattachedLimitMessage } from "@/lib/media/rules";
import { attachMedia, issueUpload, unattachedCount, verifyUpload } from "@/lib/media/store";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { putImage } from "./helpers/upload";
import { testJpeg } from "./helpers/jpeg";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let bobId: string;

async function upload(ownerId: string) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await putImage(ticket.path, testJpeg());
  expect(res.ok).toBe(true);
  return (await verifyUpload(admin, ownerId, ticket.path)).id;
}

// 上限の確かめが上げさせるか（上限は関数の中の定数 MAX_UNATTACHED。20261117140000。引換券は作ったら消す）
async function allowed() {
  const path = `${aliceId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await admin.rpc("issue_media_upload_ticket", { p_owner_id: aliceId, p_storage_path: path });
  if (error) throw error;
  await admin.from("media_upload_tickets").delete().eq("storage_path", path);
  return data !== "too_many_unattached";
}

// 数を上限に近づけるための、ファイルのない添えていない画像の記録
async function fillers(n: number): Promise<string[]> {
  if (n <= 0) return [];
  const rows = Array.from({ length: n }, () => ({ owner_id: aliceId, storage_path: `${aliceId}/${crypto.randomUUID()}.jpg`, width: 1, height: 1, size_bytes: 1 }));
  const { data, error } = await admin.from("media_files").insert(rows).select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
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
    // 上限より 1 つ少なければ上げられ、上限ちょうどなら上げられない
    const ids = await fillers(MAX_UNATTACHED - 1 - n);
    try {
      expect(await unattachedCount(admin, aliceId)).toBe(MAX_UNATTACHED - 1);
      expect(await allowed()).toBe(true);
      ids.push(...(await fillers(1)));
      expect(await unattachedCount(admin, aliceId)).toBe(MAX_UNATTACHED);
      expect(await allowed()).toBe(false);
    } finally {
      await admin.from("media_files").delete().in("id", ids);
    }
  });
  it("上限に達したときの言葉に、ほかの書きかけの分も数えること・この画面で外すこと・1 日で消えることを書く", () => {
    const m = unattachedLimitMessage();
    expect(m).toContain(`${MAX_UNATTACHED} 枚`);
    expect(m).toContain("ほかの書きかけの分も数えます");
    expect(m).toContain("この画面の要らない画像を外して");
    expect(m).toContain("1 日で消えます");
  });
});
