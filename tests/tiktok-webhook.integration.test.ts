// TikTok の Webhook（docs/design/tiktok.md の 12.）。署名を確かめ、中身は信じずに、こちらからトークンで確かめたアカウントだけを外す。
// 本物の TikTok には問い合わせない（ユーザー情報の確かめは差し替える）。テストの行はこのファイルの利用者だけに作る
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const h = await import("./helpers/supabase");
  return { createAdminClient: () => h.adminClient() };
});
import { saveConnectedAccount } from "@/lib/sns/accounts";
import { createTikTokAdapter } from "@/lib/sns/adapters/tiktok";
import { handleTikTokWebhook, verifyTikTokSignature } from "@/lib/sns/tiktok/webhook";
import { isPublicPath } from "@/lib/supabase/public-paths";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const key = randomBytes(32);
const SECRET = "test-client-secret";
const CLIENT_KEY = "test-client-key";
const adapter = createTikTokAdapter({
  config: () => ({ clientKey: CLIENT_KEY, clientSecret: SECRET, redirectUri: "http://127.0.0.1/cb" }),
  audited: () => false,
  loadTarget: async () => null,
  issueTickets: async () => [],
  clearTickets: async () => {},
});
const sign = (raw: string, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},s=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;

let alice: TestClient;
let aliceId: string;
let bobId: string;
let openId: string;
let aliceAcc: string;
let bobAcc: string;
let targetId: string;

const save = (ownerId: string, accessToken: string) =>
  saveConnectedAccount(admin, { ownerId, sns: "tiktok", externalId: openId, displayName: "こむぎ", handle: "komugi", accessToken, refreshToken: "r", expiresAt: new Date(Date.now() + 86400_000), scopes: ["video.publish"] }, key);
const event = (over: Record<string, unknown> = {}) => JSON.stringify({ client_key: CLIENT_KEY, event: "authorization.removed", create_time: 1, user_openid: openId, content: '{"reason":1}', ...over });
const status = async (id: string) => (await admin.from("social_accounts").select("status").eq("id", id).single()).data!.status;
const tokens = async (id: string) => (await admin.from("social_account_tokens").select("social_account_id").eq("social_account_id", id)).data!.length;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ userId: bobId } = await signUpNewUser());
  openId = `open-${randomUUID()}`;
  // 同じ TikTok を 2 人がつないでいる（トークンはそれぞれ別）
  aliceAcc = await save(aliceId, "alice-token");
  bobAcc = await save(bobId, "bob-token");
  const projectId = (await alice.from("projects").insert({ name: "TikTok" }).select("id").single()).data!.id;
  const postId = (await admin.from("posts").insert({ project_id: projectId, owner_id: aliceId, body: "写真", status: "draft" }).select("id").single()).data!.id;
  targetId = (await admin.from("post_targets").insert({ post_id: postId, owner_id: aliceId, sns: "tiktok", social_account_id: aliceAcc, status: "published", external_post_id: "7300", external_url: "https://www.tiktok.com/@komugi/photo/7300", published_at: new Date().toISOString() }).select("id").single()).data!.id;
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("署名", () => {
  const raw = event();
  it("client_secret で「t.本文」に付けた署名だけを通す", () => {
    expect(verifyTikTokSignature(sign(raw), raw, SECRET)).toBe(true);
    expect(verifyTikTokSignature(sign(raw, undefined, "other"), raw, SECRET)).toBe(false);
    expect(verifyTikTokSignature(sign(raw), raw + " ", SECRET)).toBe(false);
    expect(verifyTikTokSignature(null, raw, SECRET)).toBe(false);
    expect(verifyTikTokSignature("t=abc,s=00", raw, SECRET)).toBe(false);
    expect(verifyTikTokSignature(sign(raw), raw, "")).toBe(false);
  });
  it("5 分より古い・先の時刻は通さない", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyTikTokSignature(sign(raw, now - 299), raw, SECRET)).toBe(true);
    expect(verifyTikTokSignature(sign(raw, now - 301), raw, SECRET)).toBe(false);
    expect(verifyTikTokSignature(sign(raw, now + 301), raw, SECRET)).toBe(false);
  });
  it("Webhook と写真の入口は、ログインなしで届く（ログインへ転送しない）", () => {
    expect(isPublicPath("/sns/tiktok/webhook")).toBe(true);
    expect(isPublicPath("/tiktok-media/abc.jpg")).toBe(true);
    expect(isPublicPath("/sns/tiktok/connect")).toBe(false);
  });
});

describe("外されたとき（authorization.removed）", () => {
  it("ほかのアプリの通知・ほかの種類・形の違う本文は何もしない", async () => {
    const check = vi.fn(async () => false);
    for (const raw of [event({ client_key: "other" }), event({ event: "video.publish.completed" }), event({ user_openid: 1 }), "not json"]) {
      expect(await handleTikTokWebhook(admin, raw, { adapter, clientKey: CLIENT_KEY, stillAuthorized: check, key })).toEqual({ handled: "ignored", revoked: 0 });
    }
    expect(check).not.toHaveBeenCalled();
    expect(await status(aliceAcc)).toBe("active");
  });

  it("こちらから確かめて、まだ使えるトークンのアカウントは外さない（通知の中身を信じない）", async () => {
    const r = await handleTikTokWebhook(admin, event(), { adapter, clientKey: CLIENT_KEY, stillAuthorized: async () => true, key });
    expect(r).toEqual({ handled: "checked", revoked: 0 });
    expect([await status(aliceAcc), await status(bobAcc)]).toEqual(["active", "active"]);
  });

  it("使えなくなったアカウントだけを解除済みにし、トークンと受け取ったもの（投稿の ID・URL）を消す。何度届いても同じ", async () => {
    const seen: string[] = [];
    const stillAuthorized = async (token: string) => (seen.push(token), token !== "alice-token");
    expect(await handleTikTokWebhook(admin, event(), { adapter, clientKey: CLIENT_KEY, stillAuthorized, key })).toEqual({ handled: "checked", revoked: 1 });
    expect(seen.sort()).toEqual(["alice-token", "bob-token"]);
    expect([await status(aliceAcc), await status(bobAcc)]).toEqual(["revoked", "active"]);
    expect([await tokens(aliceAcc), await tokens(bobAcc)]).toEqual([0, 1]);
    const t = (await admin.from("post_targets").select("external_post_id, external_url, status").eq("id", targetId).single()).data!;
    expect(t).toEqual({ external_post_id: null, external_url: null, status: "published" });
    // もう一度届いても、外したアカウントは見ない
    expect(await handleTikTokWebhook(admin, event(), { adapter, clientKey: CLIENT_KEY, stillAuthorized, key })).toEqual({ handled: "checked", revoked: 0 });
    expect(seen.filter((s) => s === "alice-token")).toHaveLength(1);
  });

  it("確かめが TikTok の障害でできないときは投げる（500 を返してやり直してもらう）", async () => {
    await expect(handleTikTokWebhook(admin, event(), { adapter, clientKey: CLIENT_KEY, stillAuthorized: async () => { throw new Error("down"); }, key })).rejects.toThrow("down");
    expect(await status(bobAcc)).toBe("active");
  });
});

describe("入口（/sns/tiktok/webhook）", () => {
  it("署名が合わなければ 401、合えば 200（ほかの種類の通知は何もしない）", async () => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", CLIENT_KEY);
    vi.stubEnv("TIKTOK_CLIENT_SECRET", SECRET);
    vi.stubEnv("APP_URL", "http://127.0.0.1:3100");
    try {
      const { POST } = await import("@/app/sns/tiktok/webhook/route");
      const raw = event({ event: "video.publish.completed" });
      const req = (sig: string) => new Request("http://127.0.0.1:3100/sns/tiktok/webhook", { method: "POST", body: raw, headers: { "TikTok-Signature": sig } }) as never;
      expect((await POST(req(sign(raw, undefined, "wrong")))).status).toBe(401);
      expect((await POST(req(sign(raw)))).status).toBe(200);
      // 64KB を超える本文は、署名を確かめる前に 413（Content-Length を見て読まない。書いていなくても、読む量で止める）
      const big = "x".repeat(64_001);
      expect((await POST(new Request("http://127.0.0.1:3100/sns/tiktok/webhook", { method: "POST", body: big, headers: { "TikTok-Signature": sign(big) } }) as never)).status).toBe(413);
      const stream = new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(4_000)); c.close(); } });
      const chunked = new Request("http://127.0.0.1:3100/sns/tiktok/webhook", { method: "POST", body: stream, duplex: "half", headers: { "TikTok-Signature": "t=1,s=x" } } as RequestInit);
      expect(chunked.headers.get("content-length")).toBeNull();
      expect((await POST(chunked as never)).status).toBe(413);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
