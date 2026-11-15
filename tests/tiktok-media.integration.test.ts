// TikTok の表（tiktok_media_tickets・post_target_tiktok）と、写真を渡す入口（/tiktok-media/<トークン>.jpg）。docs/design/tiktok.md の 2. と 11.
import jpeg from "jpeg-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
// 入口のルートが使うサーバーの権限のクライアントを、テストのローカルの Supabase に向ける
vi.mock("@/lib/supabase/admin", async () => {
  const h = await import("./helpers/supabase");
  return { createAdminClient: () => h.adminClient() };
});
import { GET, HEAD } from "@/app/tiktok-media/[file]/route";
import { MEDIA_BUCKET } from "@/lib/media/rules";
import { attachMedia, issueUpload, verifyUpload } from "@/lib/media/store";
import { clearMediaTickets, cleanupExpiredTickets, hashTicketToken, issueMediaTickets } from "@/lib/sns/tiktok/media";
import { writeTikTokConsent } from "@/lib/sns/tiktok/consent";
import { consentHash } from "@/lib/sns/tiktok/send-check";
import { withHashtags } from "@/lib/sns/hashtags";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";
import { putImage } from "./helpers/upload";

const admin = adminClient();
let alice: TestClient;
let aliceId: string;
let bobId: string;
let projectId: string;
let postId: string;
let targetId: string;
let photo: string;
let other: string;

const realJpeg = (width: number, height: number) => {
  const data = new Uint8Array(width * height * 4).fill(200);
  return new Uint8Array(jpeg.encode({ data, width, height }, 85).data);
};
async function upload(ownerId: string, bytes = realJpeg(2048, 1536)) {
  const ticket = await issueUpload(admin, ownerId);
  const res = await putImage(ticket.path, bytes);
  expect(res.ok).toBe(true);
  return (await verifyUpload(admin, ownerId, ticket.path)).id;
}
const get = async (url: string, method: "GET" | "HEAD" = "GET") => {
  const file = url.slice(url.lastIndexOf("/") + 1);
  const ctx = { params: Promise.resolve({ file }) } as never;
  return method === "GET" ? GET(new Request(url), ctx) : HEAD(new Request(url, { method: "HEAD" }), ctx);
};
const base = "https://yabumi.app";

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  projectId = (await alice.from("projects").insert({ name: "TikTok" }).select("id").single()).data!.id;
  const { data, error } = await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: projectId, p_body: "写真", p_planned_at: null as unknown as string, p_status: "draft", p_targets: [{ sns: "tiktok" }] });
  if (error) throw error;
  postId = data!;
  targetId = (await admin.from("post_targets").select("id").eq("post_id", postId).eq("sns", "tiktok").single()).data!.id;
  photo = await upload(aliceId);
  other = await upload(aliceId);
  await attachMedia(admin, aliceId, postId, [{ id: photo, altText: "" }]);
});

afterAll(async () => {
  for (const owner of [aliceId, bobId]) {
    const { data } = await admin.storage.from(MEDIA_BUCKET).list(owner, { limit: 1000 });
    if (data?.length) await admin.storage.from(MEDIA_BUCKET).remove(data.map((f) => `${owner}/${f.name}`));
  }
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("写真を渡す入口", () => {
  it("トークンが指す、いまも投稿に添えてある画像を、1080 に縮めた JPEG で返す（3xx は返さない）", async () => {
    const [url] = await issueMediaTickets(admin, { ownerId: aliceId, postTargetId: targetId, mediaIds: [photo], baseUrl: base });
    expect(url).toMatch(/^https:\/\/yabumi\.app\/tiktok-media\/[A-Za-z0-9_-]{43}\.jpg$/);
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("location")).toBeNull();
    const img = jpeg.decode(new Uint8Array(await res.arrayBuffer()));
    expect([img.width, img.height]).toEqual([1080, 810]);
    expect((await get(url, "HEAD")).status).toBe(200);
  });

  it("知らない・形の違うトークン、期限切れ、送り終えて消した入口は 404", async () => {
    expect((await get(`${base}/tiktok-media/${"A".repeat(43)}.jpg`)).status).toBe(404);
    expect((await get(`${base}/tiktok-media/abc.jpg`)).status).toBe(404);
    const [url] = await issueMediaTickets(admin, { ownerId: aliceId, postTargetId: targetId, mediaIds: [photo], baseUrl: base });
    const token = url.slice(url.lastIndexOf("/") + 1, -4);
    await admin.from("tiktok_media_tickets").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("token_hash", hashTicketToken(token));
    expect((await get(url)).status).toBe(404);
    expect(await cleanupExpiredTickets(admin)).toBeGreaterThanOrEqual(1);
    const [url2] = await issueMediaTickets(admin, { ownerId: aliceId, postTargetId: targetId, mediaIds: [photo], baseUrl: base });
    await clearMediaTickets(admin, targetId);
    expect((await get(url2)).status).toBe(404);
  });

  it("投稿に添えていない画像・あとで外した画像は返さない", async () => {
    const [notAttached] = await issueMediaTickets(admin, { ownerId: aliceId, postTargetId: targetId, mediaIds: [other], baseUrl: base });
    expect((await get(notAttached)).status).toBe(404);
    const [url] = await issueMediaTickets(admin, { ownerId: aliceId, postTargetId: targetId, mediaIds: [photo], baseUrl: base });
    await admin.from("media_files").update({ post_id: null }).eq("id", photo);
    expect((await get(url)).status).toBe(404);
    await admin.from("media_files").update({ post_id: postId }).eq("id", photo);
  });

  it("ほかの人の画像や配信先は、入口に結びつけられない（DB のトリガー）", async () => {
    const bobPhoto = await upload(bobId, realJpeg(100, 100));
    await expect(issueMediaTickets(admin, { ownerId: aliceId, postTargetId: targetId, mediaIds: [bobPhoto], baseUrl: base })).rejects.toMatchObject({ code: "23514" });
    await expect(issueMediaTickets(admin, { ownerId: bobId, postTargetId: targetId, mediaIds: [bobPhoto], baseUrl: base })).rejects.toMatchObject({ code: "23514" });
  });
});

describe("表の権限（利用者の権限では読めない・書けない）", () => {
  it("tiktok_media_tickets・post_target_tiktok は、本人でも読めず書けない", async () => {
    await issueMediaTickets(admin, { ownerId: aliceId, postTargetId: targetId, mediaIds: [photo], baseUrl: base });
    const consent = { post_target_id: targetId, owner_id: aliceId, privacy_level: "SELF_ONLY", consented_at: new Date().toISOString(), consent_text_hash: "0".repeat(64), consent_nickname: "こむぎ" };
    expect((await admin.from("post_target_tiktok").upsert(consent)).error).toBeNull();
    for (const table of ["tiktok_media_tickets", "post_target_tiktok"] as const) {
      const { data, error } = await alice.from(table).select("*");
      expect(error ?? data?.length === 0 ? true : data, table).toBeTruthy();
      expect((data ?? []).length, table).toBe(0);
    }
    expect((await alice.from("post_target_tiktok").insert(consent)).error).not.toBeNull();
    expect((await alice.from("post_target_tiktok").update({ privacy_level: "PUBLIC_TO_EVERYONE" }).eq("post_target_id", targetId).select()).data ?? []).toEqual([]);
    expect((await alice.from("tiktok_media_tickets").insert({ token_hash: "1".repeat(64), owner_id: aliceId, post_target_id: targetId, media_id: photo, expires_at: new Date().toISOString() })).error).not.toBeNull();
  });

  it("ブランドコンテンツは「自分だけ」にできない（check）", async () => {
    const { error } = await admin.from("post_target_tiktok").upsert({ post_target_id: targetId, owner_id: aliceId, privacy_level: "SELF_ONLY", brand_content: true, consented_at: new Date().toISOString(), consent_text_hash: "0".repeat(64), consent_nickname: "こむぎ" });
    expect(error?.code).toBe("23514");
  });

  it("配信先を消すと、同意の記録と入口も一緒に消える（on delete cascade）", async () => {
    const { data, error } = await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: projectId, p_body: "消す", p_planned_at: null as unknown as string, p_status: "draft", p_targets: [{ sns: "tiktok" }] });
    if (error) throw error;
    const t = (await admin.from("post_targets").select("id").eq("post_id", data!).single()).data!.id;
    await admin.from("post_target_tiktok").insert({ post_target_id: t, owner_id: aliceId, privacy_level: "SELF_ONLY", consented_at: new Date().toISOString(), consent_text_hash: "0".repeat(64), consent_nickname: "こむぎ" });
    await issueMediaTickets(admin, { ownerId: aliceId, postTargetId: t, mediaIds: [photo], baseUrl: base });
    await admin.from("post_targets").delete().eq("id", t);
    expect((await admin.from("post_target_tiktok").select("post_target_id").eq("post_target_id", t)).data).toEqual([]);
    expect((await admin.from("tiktok_media_tickets").select("token_hash").eq("post_target_id", t)).data).toEqual([]);
  });
});

describe("同意の記録（savePost のあとにサーバーが書く）", () => {
  const creator = { username: "komugi_bakery", nickname: "こむぎ", avatarUrl: null, privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxVideoPostDurationSec: null };
  const choice = { privacyLevel: "PUBLIC_TO_EVERYONE" as const, allowComment: true, commercial: true, brandOrganic: true, brandContent: false, mode: "DIRECT_POST" as const };
  let consentPostId: string;
  let consentTargetId: string;
  let aiPhoto: string;
  const body = "焼きたてのパン\u3000\n";
  const tags = ["パン", "新作"];

  beforeAll(async () => {
    const { data, error } = await alice.rpc("save_post", { p_post_id: null as unknown as string, p_project_id: projectId, p_body: body, p_planned_at: null as unknown as string, p_status: "draft", p_targets: [{ sns: "tiktok", title: "新作", hashtags: tags }] });
    if (error) throw error;
    consentPostId = data!;
    consentTargetId = (await admin.from("post_targets").select("id").eq("post_id", consentPostId).single()).data!.id;
    aiPhoto = await upload(aliceId, realJpeg(100, 100));
    await admin.from("media_files").update({ ai_generated: true }).eq("id", aiPhoto);
    await attachMedia(admin, aliceId, consentPostId, [{ id: aiPhoto, altText: "" }]);
  });

  it("時刻・文の指紋・AI の印・ニックネームはサーバーが決め、指紋は送信ジョブが送る文（post_target_text）と同じ", async () => {
    const now = new Date("2026-11-14T09:00:00Z");
    await writeTikTokConsent(admin, { userId: aliceId, postId: consentPostId, title: "新作", text: withHashtags(body, tags), mediaIds: [aiPhoto], checked: { choice, creator }, now });
    const row = (await admin.from("post_target_tiktok").select("*").eq("post_target_id", consentTargetId).single()).data!;
    expect(row).toMatchObject({ owner_id: aliceId, privacy_level: "PUBLIC_TO_EVERYONE", disable_comment: false, brand_organic: true, brand_content: false, post_mode: "DIRECT_POST", is_aigc: true, consent_nickname: "こむぎ", consent_username: "komugi_bakery" });
    expect(new Date(row.consented_at).toISOString()).toBe(now.toISOString());
    const { data: sent } = await admin.rpc("post_target_text", { p_text: body, p_hashtags: tags });
    expect(row.consent_text_hash).toBe(consentHash("新作", sent!));
  });

  it("下書き（MEDIA_UPLOAD）は公開範囲・コメント・宣伝の印を持たない", async () => {
    await writeTikTokConsent(admin, { userId: aliceId, postId: consentPostId, title: "新作", text: "x", mediaIds: [], checked: { choice: { ...choice, mode: "MEDIA_UPLOAD" }, creator } });
    const row = (await admin.from("post_target_tiktok").select("*").eq("post_target_id", consentTargetId).single()).data!;
    expect(row).toMatchObject({ privacy_level: "SELF_ONLY", disable_comment: true, brand_organic: false, brand_content: false, post_mode: "MEDIA_UPLOAD", is_aigc: false });
  });

  it("ほかの人の投稿には書けない", async () => {
    await expect(writeTikTokConsent(admin, { userId: bobId, postId: consentPostId, title: "", text: "", mediaIds: [], checked: { choice, creator } })).rejects.toBeTruthy();
    const { count } = await admin.from("post_target_tiktok").select("post_target_id", { count: "exact", head: true }).eq("owner_id", bobId);
    expect(count).toBe(0);
  });
});
