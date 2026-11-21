// YouTube の表と関数（docs/design/youtube.md の 6.・8.・12.。20261115110000_youtube）。
// post_target_youtube・youtube_uploads は利用者の権限では読めず書けない、持ち主のトリガー、1 日の上限（全体と利用者ごと・同時実行）、
// アップロードの途中の情報の暗号化、手で投稿したことの記録。テストの行はこのファイルの利用者だけに作り、上限は小さな値で試す（共有のローカル DB）
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { purgeSnsDataOf, saveConnectedAccount } from "@/lib/sns/accounts";
import { BY_HAND_MESSAGE } from "@/lib/sns/by-hand";
import { consentHash } from "@/lib/sns/tiktok/send-check";
import { YOUTUBE_GLOBAL_DAILY_UPLOADS, YOUTUBE_USER_DAILY_UPLOADS } from "@/lib/sns/youtube/config";
import { clearYouTubeUpload, loadYouTubeTarget, loadYouTubeUpload, reserveYouTubeUpload, saveYouTubeUpload } from "@/lib/sns/youtube/store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let bobProject: string;

async function target(sns: string, owner = aliceId, project = projectId, status = "pending", extra: Record<string, unknown> = {}) {
  const { data: p, error } = await admin.from("posts").insert({ project_id: project, owner_id: owner, body: `投稿 ${randomUUID()}`, status: "draft" }).select("id").single();
  if (error) throw error;
  const { data: t, error: e2 } = await admin.from("post_targets").insert({ post_id: p!.id, owner_id: owner, sns, status, title: "新しいパン", ...extra }).select("id").single();
  if (e2) throw e2;
  return { postId: p!.id, targetId: t!.id };
}

const consent = (targetId: string, owner = aliceId) => ({
  post_target_id: targetId,
  owner_id: owner,
  privacy_status: "unlisted",
  made_for_kids: false,
  synthetic_media: false,
  category_id: "22",
  consented_at: new Date().toISOString(),
  consent_text_hash: consentHash("新しいパン", "説明"),
  consent_channel: "こむぎのパン",
});

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "YouTube" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "べつの人" }).select("id").single()).data!.id;
});

afterAll(async () => {
  await admin.from("sns_api_usage").delete().in("owner_id", [aliceId, bobId]);
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("権限（利用者の権限では読めず書けない）", () => {
  it("post_target_youtube・youtube_uploads は、本人も他人もログインしていない人も読めず書けない", async () => {
    const { targetId } = await target("youtube");
    expect((await admin.from("post_target_youtube").insert(consent(targetId))).error).toBeNull();
    await saveYouTubeUpload(admin, targetId, aliceId, { sessionUri: "https://upload.example/s", bytesTotal: 10, bytesSent: 0, videoId: null }, new Date(), key);
    for (const table of ["post_target_youtube", "youtube_uploads"] as const) {
      for (const [who, client] of [["本人", alice], ["他人", bob], ["anon", anonClient()]] as const) {
        const r = await client.from(table).select("post_target_id").eq("post_target_id", targetId);
        expect(r.error, `${table} ${who}`).not.toBeNull();
      }
      expect((await alice.from(table).delete().eq("post_target_id", targetId)).error, table).not.toBeNull();
    }
    expect((await alice.from("post_target_youtube").insert(consent((await target("youtube")).targetId))).error).not.toBeNull();
    expect((await alice.from("post_target_youtube").update({ privacy_status: "public" }).eq("post_target_id", targetId)).error).not.toBeNull();
    expect((await admin.from("post_target_youtube").select("privacy_status").eq("post_target_id", targetId).single()).data!.privacy_status).toBe("unlisted");
  });

  it("持ち主のトリガー: ほかの人の配信先・YouTube でない配信先には、サーバーの権限でも行を作れない", async () => {
    const bobs = await target("youtube", bobId, bobProject);
    const x = await target("x");
    expect((await admin.from("post_target_youtube").insert(consent(bobs.targetId, aliceId))).error?.code).toBe("23514");
    expect((await admin.from("post_target_youtube").insert(consent(x.targetId))).error?.code).toBe("23514");
    expect((await admin.from("youtube_uploads").insert({ post_target_id: x.targetId, owner_id: aliceId, bytes_total: 1 })).error?.code).toBe("23514");
  });

  it("関数は利用者から呼べない（reserve_youtube_upload）", async () => {
    const { targetId } = await target("youtube");
    const r = await alice.rpc("reserve_youtube_upload", { p_owner_id: aliceId, p_post_target_id: targetId });
    expect(r.error).not.toBeNull();
  });
});

describe("アップロードの途中の情報", () => {
  it("セッションの URL は暗号化して持ち、読むときに戻す。上げ終えたら URL は持たず、消しても残る", async () => {
    const { targetId } = await target("youtube");
    const uri = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret";
    await saveYouTubeUpload(admin, targetId, aliceId, { sessionUri: uri, bytesTotal: 100, bytesSent: 40, videoId: null }, new Date(), key);
    const raw = (await admin.from("youtube_uploads").select("session_uri_encrypted, processing_check_until").eq("post_target_id", targetId).single()).data!;
    expect(raw.session_uri_encrypted).not.toContain("upload_id");
    expect(raw.processing_check_until).toBeNull();
    expect(await loadYouTubeUpload(admin, targetId, key)).toEqual({ sessionUri: uri, bytesTotal: 100, bytesSent: 40, videoId: null });

    await saveYouTubeUpload(admin, targetId, aliceId, { sessionUri: uri, bytesTotal: 100, bytesSent: 100, videoId: "vid_ABC123" }, new Date(), key);
    const done = (await admin.from("youtube_uploads").select("session_uri_encrypted, processing_check_until").eq("post_target_id", targetId).single()).data!;
    expect(done.session_uri_encrypted).toBeNull();
    expect(done.processing_check_until).not.toBeNull();
    await clearYouTubeUpload(admin, targetId);
    expect((await loadYouTubeUpload(admin, targetId, key))?.videoId).toBe("vid_ABC123");
  });

  it("同意の記録を読む（YouTube の配信先だけ）。配信先を消すと一緒に消える", async () => {
    const { postId, targetId } = await target("youtube");
    await admin.from("post_target_youtube").insert(consent(targetId));
    expect(await loadYouTubeTarget(admin, targetId)).toMatchObject({ ownerId: aliceId, postId, title: "新しいパン", settings: { privacy_status: "unlisted", category_id: "22" } });
    expect(await loadYouTubeTarget(admin, (await target("x")).targetId)).toBeNull();
    await admin.from("posts").delete().eq("id", postId);
    expect((await admin.from("post_target_youtube").select("post_target_id").eq("post_target_id", targetId)).data).toEqual([]);
  });
});

describe("外されたとき（purgeSnsDataOf）", () => {
  it("そのアカウントの配信先の、アップロードの途中の情報と同意の記録（チャンネル名）を消す。本文は残す", async () => {
    const accountId = await saveConnectedAccount(
      admin,
      { ownerId: aliceId, sns: "youtube", externalId: `UC_${randomUUID()}`, displayName: "こむぎのパン", handle: "komugi", accessToken: "a", refreshToken: "r", expiresAt: new Date("2099-01-01"), scopes: [] },
      key,
    );
    const { postId, targetId } = await target("youtube", aliceId, projectId, "published", { social_account_id: accountId, external_post_id: "vid_ABC123" });
    await admin.from("post_target_youtube").insert(consent(targetId));
    await saveYouTubeUpload(admin, targetId, aliceId, { sessionUri: null, bytesTotal: 10, bytesSent: 10, videoId: "vid_ABC123" }, new Date(), key);
    await purgeSnsDataOf(admin, [accountId]);
    expect((await admin.from("youtube_uploads").select("post_target_id").eq("post_target_id", targetId)).data).toEqual([]);
    expect((await admin.from("post_target_youtube").select("post_target_id").eq("post_target_id", targetId)).data).toEqual([]);
    expect((await admin.from("post_targets").select("external_post_id").eq("id", targetId).single()).data!.external_post_id).toBeNull();
    expect((await admin.from("posts").select("body").eq("id", postId).single()).data!.body).toMatch(/^投稿/);
  });
});

describe("1 日のアップロードの数", () => {
  // 上限は関数の中の定数（全体 90 本・利用者ごと 5 本。20261117140000）。全体の数は共有の DB のほかの行も数えるので、
  // 全体の上限は p_scope_owner で、別のテストの利用者（carol）の行だけを数えて試す
  it("利用者ごと 5 本を超えたら取らない。同時に 7 本取っても 5 本だけ", async () => {
    const { targetId } = await target("youtube");
    const results = await Promise.all(Array.from({ length: 7 }, () => reserveYouTubeUpload(admin, aliceId, targetId, { scopeOwner: aliceId })));
    expect(results.filter((r) => r === "ok").length).toBe(YOUTUBE_USER_DAILY_UPLOADS);
    expect(results.filter((r) => r === "user").length).toBe(7 - YOUTUBE_USER_DAILY_UPLOADS);
  });

  it("全体 90 本に当たれば、まだ 0 本の人も取れない（89 本なら取れる）。記録は本人だけ読める", async () => {
    const { userId: carolId } = await signUpNewUser();
    try {
      const rows = Array.from({ length: YOUTUBE_GLOBAL_DAILY_UPLOADS - 1 }, () => ({ owner_id: carolId, sns: "youtube" as const, operation: "upload", cost_usd: 0 }));
      expect((await admin.from("sns_api_usage").insert(rows)).error).toBeNull();
      const bobs = await target("youtube", bobId, bobProject);
      // 89 本: bob は取れる（bob の 1 本は carol の数には入らないので、もう一度でも取れる）
      expect(await reserveYouTubeUpload(admin, bobId, bobs.targetId, { scopeOwner: carolId })).toBe("ok");
      expect((await admin.from("sns_api_usage").insert({ owner_id: carolId, sns: "youtube", operation: "upload", cost_usd: 0 })).error).toBeNull();
      // 90 本: bob はまだ 1 本でも取れない
      expect(await reserveYouTubeUpload(admin, bobId, bobs.targetId, { scopeOwner: carolId })).toBe("global");
      const mine = await bob.from("sns_api_usage").select("operation, cost_usd").eq("sns", "youtube");
      expect(mine.data).toEqual([{ operation: "upload", cost_usd: 0 }]);
      expect((await bob.from("sns_api_usage").select("id").eq("owner_id", aliceId)).data).toEqual([]);
    } finally {
      await deleteUser(carolId);
    }
  });
});

describe("YouTube は手動で投稿する", () => {
  it("手動で投稿するの YouTube は要確認で閉じる対象に入らず（SQL と TS の文が同じ）、手動で投稿したと記録できる", async () => {
    const { targetId } = await target("youtube", aliceId, projectId, "failed", { error_message: BY_HAND_MESSAGE.youtube });
    const closed = await alice.rpc("close_attention", { p_project_id: projectId, p_items: [{ kind: "failed", id: targetId }] as never });
    expect(closed.error).toBeNull();
    expect(closed.data).toBe(0);
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: targetId, p_url: "https://www.youtube.com/watch?v=abc" })).error).toBeNull();
    expect((await admin.from("post_targets").select("status, external_url").eq("id", targetId).single()).data).toEqual({ status: "published", external_url: "https://www.youtube.com/watch?v=abc" });
    // 他人の配信先は記録できない
    const bobs = await target("youtube", bobId, bobProject, "failed", { error_message: BY_HAND_MESSAGE.youtube });
    expect((await alice.rpc("mark_manual_target_posted", { p_target_id: bobs.targetId })).error?.code).toBe("P0002");
  });
});
