// スマホの通知（Web Push。docs/architecture.md の 4.28）。宛先の RLS と権限、登録・外す・送る・試しに送る。
// push サービスには送らない（送る部品は差し替える）
import { randomBytes } from "node:crypto";
import { WebPushError } from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_DEVICES_PER_USER } from "@/lib/push/rules";
import { type PushSender, hasPushDevice, sendPush } from "@/lib/push/send";
import { listDevices, registerDevice, removeDevice, removeDeviceOnLogout, sendTestPush } from "@/lib/push/store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const env = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:ops@example.com" };

let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;

function newSub(host = "fcm.googleapis.com") {
  return {
    endpoint: `https://${host}/fcm/send/${randomBytes(12).toString("hex")}`,
    keys: { p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
}

// 送った宛先を覚え、宛先ごとに決めた結果を返す
function mockSender(fail: Record<string, number> = {}) {
  const calls: { endpoint: string; payload: unknown; options: Parameters<PushSender>[2] }[] = [];
  const sender: PushSender = async (target, payload, options) => {
    calls.push({ endpoint: target.endpoint, payload: JSON.parse(payload), options });
    const status = fail[target.endpoint];
    if (status) throw new WebPushError("failed", status, {}, "", target.endpoint);
    return { statusCode: 201 };
  };
  return { sender, calls };
}

async function register(userId: string, sub = newSub()) {
  const r = await registerDevice(admin, userId, sub, "テストの端末");
  if (!r.ok) throw new Error(r.message);
  return { id: r.id, sub };
}

async function clear(userId: string) {
  await admin.from("push_subscriptions").delete().eq("user_id", userId);
}

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
});

afterAll(async () => {
  await deleteUser(aliceId);
  await deleteUser(bobId);
});

describe("RLS と権限", () => {
  it("本人は自分の端末だけを読め、他人は読めず、消せない", async () => {
    const { id } = await register(aliceId);
    expect((await listDevices(alice)).map((d) => d.id)).toContain(id);
    expect(await listDevices(bob)).toEqual([]);
    expect((await bob.from("push_subscriptions").select("id").eq("id", id)).data).toEqual([]);
    expect(await removeDevice(bob, id)).toMatchObject({ ok: false });
    expect((await admin.from("push_subscriptions").select("id").eq("id", id)).data).toHaveLength(1);
  });

  it("暗号の鍵は本人にも読ませない。書き込みはサーバーだけ", async () => {
    expect((await alice.from("push_subscriptions").select("p256dh").limit(1)).error?.code).toBe("42501");
    expect((await alice.from("push_subscriptions").select("auth").limit(1)).error?.code).toBe("42501");
    expect((await alice.from("push_subscriptions").insert({ user_id: aliceId, ...{ endpoint: newSub().endpoint, p256dh: "x", auth: "y" } })).error?.code).toBe("42501");
    expect((await alice.from("push_subscriptions").update({ device_label: "書き換え" }).eq("user_id", aliceId)).error?.code).toBe("42501");
  });

  it("ログインしていない人は読めない", async () => {
    expect((await anonClient().from("push_subscriptions").select("id").limit(1)).error?.code).toBe("42501");
  });

  it("本人は自分の端末を外せる", async () => {
    const { id } = await register(aliceId);
    expect(await removeDevice(alice, id)).toEqual({ ok: true });
    expect((await admin.from("push_subscriptions").select("id").eq("id", id)).data).toEqual([]);
  });
});

describe("登録", () => {
  it("許可していないホストの宛先は登録しない", async () => {
    expect(await registerDevice(admin, aliceId, newSub("evil.example"), "x")).toMatchObject({ ok: false });
  });

  it("同じ端末で別の人が登録し直したら、宛先はその人に移る（前の人には届かない）", async () => {
    const { id, sub } = await register(aliceId);
    const again = await registerDevice(admin, bobId, sub, "x");
    expect(again).toEqual({ ok: true, id });
    expect((await admin.from("push_subscriptions").select("user_id").eq("id", id).single()).data?.user_id).toBe(bobId);
    expect((await listDevices(alice)).map((d) => d.id)).not.toContain(id);
    await clear(bobId);
  });

  it(`1 人 ${MAX_DEVICES_PER_USER} 台まで。超えたら古いものから外す`, async () => {
    await clear(aliceId);
    const ids: string[] = [];
    for (let i = 0; i < MAX_DEVICES_PER_USER + 2; i++) {
      ids.push((await register(aliceId)).id);
      // 登録の順を確かにする
      await new Promise((r) => setTimeout(r, 5));
    }
    const left = (await listDevices(alice)).map((d) => d.id);
    expect(left).toHaveLength(MAX_DEVICES_PER_USER);
    expect(left).not.toContain(ids[0]);
    expect(left).not.toContain(ids[1]);
    expect(left).toContain(ids.at(-1));
    await clear(aliceId);
  });

  it("ログアウトしたら、その端末を外す（本人のものだけ）", async () => {
    const { id } = await register(aliceId);
    await removeDeviceOnLogout(admin, bobId, id);
    expect(await hasPushDevice(admin, aliceId)).toBe(true);
    await removeDeviceOnLogout(admin, aliceId, id);
    expect(await hasPushDevice(admin, aliceId)).toBe(false);
  });
});

describe("送る", () => {
  it("登録したすべての端末に送り、届けた日時を残す。中身は題・本文・URL・tag", async () => {
    await clear(aliceId);
    const a = await register(aliceId);
    const b = await register(aliceId);
    await register(bobId);
    const { sender, calls } = mockSender();
    const r = await sendPush(admin, aliceId, { title: "今週の投稿、あと 2 本です", body: "水曜までに 1 本出すと、目標に届きます", url: "/projects/p1/compose", tag: "pace:p1" }, { sender, env });
    expect(r).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(calls.map((c) => c.endpoint).sort()).toEqual([a.sub.endpoint, b.sub.endpoint].sort());
    expect(calls[0].payload).toEqual({ title: "今週の投稿、あと 2 本です", body: "水曜までに 1 本出すと、目標に届きます", url: "/projects/p1/compose", tag: "pace:p1" });
    expect(calls[0].options.vapidDetails).toEqual({ subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
    expect(calls[0].options.TTL).toBe(86400);
    expect(calls[0].options.topic).toMatch(/^[\w-]{32}$/);
    const { data } = await admin.from("push_subscriptions").select("last_success_at").eq("user_id", aliceId);
    expect(data!.every((d) => d.last_success_at)).toBe(true);
    await clear(bobId);
  });

  it("送れなくなった宛先（404・410）は消し、ほかの失敗は残す", async () => {
    await clear(aliceId);
    const ok = await register(aliceId);
    const gone = await register(aliceId);
    const notFound = await register(aliceId);
    const busy = await register(aliceId);
    const { sender } = mockSender({ [gone.sub.endpoint]: 410, [notFound.sub.endpoint]: 404, [busy.sub.endpoint]: 503 });
    const r = await sendPush(admin, aliceId, { title: "t", body: "b", url: "/" }, { sender, env });
    expect(r).toEqual({ sent: 1, removed: 2, failed: 1 });
    const left = (await listDevices(alice)).map((d) => d.id).sort();
    expect(left).toEqual([ok.id, busy.id].sort());
    await clear(aliceId);
  });

  it("端末がなければ送らない。VAPID の鍵がなければ送らない", async () => {
    await clear(aliceId);
    const { sender, calls } = mockSender();
    expect(await sendPush(admin, aliceId, { title: "t", body: "b", url: "/" }, { sender, env })).toEqual({ sent: 0, removed: 0, failed: 0 });
    await register(aliceId);
    expect(await sendPush(admin, aliceId, { title: "t", body: "b", url: "/" }, { sender, env: {} })).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(calls).toHaveLength(0);
    expect(await hasPushDevice(admin, aliceId)).toBe(true);
    await clear(aliceId);
  });

  it("DB に許可していないホストが入っていたら、送らずに消す", async () => {
    const { data } = await admin
      .from("push_subscriptions")
      .insert({ user_id: aliceId, endpoint: "https://evil.example/x", p256dh: "k".repeat(87), auth: "a".repeat(22) })
      .select("id")
      .single();
    const { sender, calls } = mockSender();
    expect(await sendPush(admin, aliceId, { title: "t", body: "b", url: "/" }, { sender, env })).toEqual({ sent: 0, removed: 1, failed: 0 });
    expect(calls).toHaveLength(0);
    expect((await admin.from("push_subscriptions").select("id").eq("id", data!.id)).data).toEqual([]);
  });
});

describe("試しに送る", () => {
  it("本人の端末 1 つにだけ送り、30 秒は続けて送れない。他人の端末には送れない", async () => {
    await clear(aliceId);
    const a = await register(aliceId);
    await register(aliceId);
    const { sender, calls } = mockSender();
    expect(await sendTestPush(admin, aliceId, a.id, { sender, env })).toMatchObject({ ok: true });
    expect(calls.map((c) => c.endpoint)).toEqual([a.sub.endpoint]);
    expect(await sendTestPush(admin, aliceId, a.id, { sender, env })).toMatchObject({ ok: false });
    expect(await sendTestPush(admin, bobId, a.id, { sender, env })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
    await clear(aliceId);
  });

  it("届けられなくなっていたら、登録し直すよう知らせる", async () => {
    const a = await register(aliceId);
    const { sender } = mockSender({ [a.sub.endpoint]: 410 });
    const r = await sendTestPush(admin, aliceId, a.id, { sender, env });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.message).toContain("もう一度");
    expect(await hasPushDevice(admin, aliceId)).toBe(false);
  });
});

describe("退会", () => {
  it("利用者を消すと、端末の登録も消える", async () => {
    const { client: carol, userId: carolId } = await signUpNewUser();
    void carol;
    await register(carolId);
    await deleteUser(carolId);
    expect((await admin.from("push_subscriptions").select("id").eq("user_id", carolId)).data).toEqual([]);
  });
});
