// 運営者へのメールの知らせ（docs/architecture.md の 4.22「悪用への備え」、決定 D22）。Resend は偽物の fetch で、本物には送らない
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { alertIfNearBudget, budgetAlertKey, budgetAlertMail } from "@/lib/notify/budget";
import { notifyOperator, notifyOperatorOnce, RESEND_API_URL } from "@/lib/notify/operator";
import { checkPlayCapacity, playCapacityMail, playCapacityThresholds } from "@/lib/stores/play-store";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
const ok = () => vi.fn(async () => new Response(JSON.stringify({ id: "mail-1" }), { status: 200 }));
const ng = () => vi.fn(async () => new Response("bad", { status: 500 }));
const deps = (f: ReturnType<typeof vi.fn>) => ({ fetch: f as unknown as typeof fetch, apiKey: "re_test", to: "operator@yabumi.test", from: "矢書 <noreply@yabumi.test>" });
// このテストで使う知らせの名前（ほかのテストや本当の記録と重ならないように）
const KEY = `test:${randomUUID()}`;

let alice: TestClient;
let aliceId: string;
// 作成数を 1 以上にするための記録（数えるだけなので、存在しない利用者の ID でよい）
const filler = randomUUID();

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  await admin.from("play_account_creations").insert({ owner_id: filler });
});

afterAll(async () => {
  await admin.from("operator_notifications").delete().in("key", [KEY, "play_capacity:1", "play_capacity:100000"]);
  await admin.from("play_account_creations").delete().eq("owner_id", filler);
  await deleteUser(aliceId);
});

describe("送る部分", () => {
  it("Resend の API に、送り先・件名（印つき）・本文を送る", async () => {
    const f = ok();
    expect(await notifyOperator({ subject: "件名", text: "本文" }, deps(f))).toBe("sent");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_API_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toEqual({ from: "矢書 <noreply@yabumi.test>", to: ["operator@yabumi.test"], subject: "【矢書の運営】件名", text: "本文" });
  });

  it("キーか送り先がなければ送らず、ログにだけ残す。送れなければ failed", async () => {
    const f = ok();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await notifyOperator({ subject: "s", text: "t" }, { ...deps(f), apiKey: null })).toBe("logged");
    expect(await notifyOperator({ subject: "s", text: "t" }, { ...deps(f), to: "" })).toBe("logged");
    expect(f).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(await notifyOperator({ subject: "s", text: "t" }, deps(ng()))).toBe("failed");
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("同じ件は期間の中で 1 回だけ", () => {
  it("送れたら期間の中は送らない。送れなかったら記録を消して、次にまた送る", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await notifyOperatorOnce(admin, KEY, 30, { subject: "s", text: "t" }, deps(ng()))).toBe("failed");
    const f = ok();
    expect(await notifyOperatorOnce(admin, KEY, 30, { subject: "s", text: "t" }, deps(f))).toBe("sent");
    expect(await notifyOperatorOnce(admin, KEY, 30, { subject: "s", text: "t" }, deps(f))).toBe("skipped");
    expect(f).toHaveBeenCalledTimes(1);
    // 同時に呼ばれても 1 回だけ
    await admin.from("operator_notifications").delete().eq("key", KEY);
    const g = ok();
    const results = await Promise.all(Array.from({ length: 5 }, () => notifyOperatorOnce(admin, KEY, 30, { subject: "s", text: "t" }, deps(g))));
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(g).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("記録はサーバーだけが扱う（利用者・ログインなしは読めも書けもしない）", async () => {
    expect((await alice.from("operator_notifications").select("*").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("operator_notifications").select("*").limit(1)).error?.code).toBe("42501");
    expect((await alice.rpc("claim_operator_notification", { p_key: KEY, p_window: "1 day" })).error?.code).toBe("42501");
  });
});

describe("Google Play の作成数", () => {
  it("しきい値に達したものだけ、30 日に 1 回知らせる。本文に利用者の情報を入れない", async () => {
    const f = ok();
    const first = await checkPlayCapacity(admin, { thresholds: [1, 100000], notify: deps(f) });
    expect(first.count).toBeGreaterThanOrEqual(1);
    expect(first.notified).toEqual([1]);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.text).toContain(`直近 30 日に作った数: ${first.count}`);
    expect(body.text).toContain("docs/deploy.md の 15");
    expect(body.text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect((await checkPlayCapacity(admin, { thresholds: [1, 100000], notify: deps(f) })).notified).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("しきい値は環境変数で変えられる（既定 60・80）。上限に達したときは件名が変わる", () => {
    expect(playCapacityThresholds(undefined)).toEqual([60, 80]);
    expect(playCapacityThresholds("70, 50,x,50")).toEqual([50, 70]);
    expect(playCapacityThresholds("")).toEqual([60, 80]);
    expect(playCapacityMail(60, 60).subject).toContain("60 に達しました");
    expect(playCapacityMail(80, 80).subject).toContain("上限（80）に達しました");
  });
});

describe("全体の上限の 80% の知らせ（X・AI）", () => {
  // key を分けるための範囲（本番の知らせの記録とぶつからないように）
  const scope = `test-${randomUUID()}`;
  const now = new Date("2026-10-20T00:00:00Z");
  afterAll(async () => {
    await admin.from("operator_notifications").delete().in("key", [budgetAlertKey("ai", now, scope), budgetAlertKey("x", now, scope)]);
  });

  it("80% に届かなければ知らせない", async () => {
    const f = ok();
    expect(await alertIfNearBudget(admin, "ai", 7.9, 10, { now, scope, notify: deps(f) })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("80% 以上なら、同じ月は 1 回だけ知らせる", async () => {
    const f = ok();
    expect(await alertIfNearBudget(admin, "ai", 8, 10, { now, scope, notify: deps(f) })).toBe("sent");
    expect(await alertIfNearBudget(admin, "ai", 9, 10, { now, scope, notify: deps(f) })).toBe("skipped");
    expect(f).toHaveBeenCalledTimes(1);
    // X は別に数える
    expect(await alertIfNearBudget(admin, "x", 2.5, 3, { now, scope, notify: deps(f) })).toBe("sent");
  });

  it("月ごとに key が変わる（日本時間）", () => {
    expect(budgetAlertKey("x", new Date("2026-10-31T15:00:00Z"))).toBe("budget_80:x:2026-11");
    expect(budgetAlertKey("x", new Date("2026-10-31T14:59:59Z"))).toBe("budget_80:x:2026-10");
  });

  it("本文には額と上限と確かめ方だけを入れ、上限に達したときは件名で分かる", () => {
    const near = budgetAlertMail("ai", 8, 10);
    expect(near.subject).toContain("80%");
    expect(near.text).toContain("AI_GLOBAL_MONTHLY_BUDGET_USD");
    expect(budgetAlertMail("x", 3, 3).subject).toContain("上限に達しました");
  });
});
