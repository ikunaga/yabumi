// 招待の申し込み（F19。docs/architecture.md の 4.29）。権限、二重の申し込み、上限、取り消し、招待・お断り。
// メールは送らない（送る部品を差し替える）。招待のメールはローカルの Supabase（Inbucket）に届くだけ
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { isOperatorEmail } from "@/lib/waitlist/operator";
import { ALL_PER_HOUR, PER_IP_PER_HOUR, cleanNote, normalizeEmail } from "@/lib/waitlist/rules";
import { applyWaitlist, cancelWaitlist, confirmationMail, declineWaitlist, inviteFromWaitlist, ipHash, sha256, type ApplyDeps } from "@/lib/waitlist/store";
import { holdLockDuringFile } from "./helpers/lock";
import { adminClient, anonClient, deleteUser, signUpNewUser } from "./helpers/supabase";

// 全員を合わせた 1 時間の上限を確かめるテストがあるので、同じマシンのこのファイルは 1 つずつ流す
holdLockDuringFile("waitlist-global");

const admin = adminClient();
const emails: string[] = [];

function newEmail() {
  const e = `waitlist-${randomUUID()}@example.com`;
  emails.push(e);
  return e;
}

function deps(over: Partial<ApplyDeps> = {}) {
  const sendMail = vi.fn(async () => "sent" as const);
  return { sendMail, deps: { appUrl: "https://yabumi.test", hashKey: "k", sendMail, ...over } satisfies ApplyDeps };
}

const input = (email: string, ip: string | null = `198.51.100.${Math.floor(Math.random() * 250)}`) => ({ email, appNote: "家計簿のアプリ", snsNote: "X と Threads", ip, turnstileToken: null, honeypot: "" });

afterAll(async () => {
  await admin.from("waitlist").delete().in("email", emails);
  // 招待で作られた利用者を消す
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users) if (u.email && emails.includes(u.email)) await deleteUser(u.id);
});

describe("決まり", () => {
  it("メールアドレスを小文字にそろえ、形の違うものは受けない。一言は 200 字まで", () => {
    expect(normalizeEmail("  Dev@Example.COM ")).toBe("dev@example.com");
    expect(normalizeEmail("no-at-mark")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a b@example.com")).toBeNull();
    expect(Array.from(cleanNote("あ".repeat(300)))).toHaveLength(200);
    expect(cleanNote("  改行\nあり  ")).toBe("改行 あり");
  });

  it("IP のハッシュは日ごとに変わる（日をまたいでつなげられない）", () => {
    const a = ipHash("203.0.113.1", "k", new Date("2026-10-12T03:00:00Z"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash("203.0.113.1", "k", new Date("2026-10-12T10:00:00Z"))).toBe(a);
    expect(ipHash("203.0.113.1", "k", new Date("2026-10-13T03:00:00Z"))).not.toBe(a);
    expect(ipHash("203.0.113.2", "k", new Date("2026-10-12T03:00:00Z"))).not.toBe(a);
  });

  it("運営者はログインしたアドレスが OPERATOR_ADMIN_EMAILS に入っている人だけ", () => {
    expect(isOperatorEmail("Owner@Example.com", "owner@example.com, ops@example.com")).toBe(true);
    expect(isOperatorEmail("other@example.com", "owner@example.com")).toBe(false);
    expect(isOperatorEmail("owner@example.com", undefined)).toBe(false);
    expect(isOperatorEmail(null, "owner@example.com")).toBe(false);
  });

  it("確認のメールに、取り消しのリンクと招待制であることを書く", () => {
    const m = confirmationMail("a@example.com", "https://yabumi.test/waitlist/cancel?t=abc");
    expect(m.text).toContain("https://yabumi.test/waitlist/cancel?t=abc");
    expect(m.text).toContain("招待制");
    // 規約と同じく、必ず招待するとは限らないことを書く
    expect(m.text).toContain("お断りすることもあります");
  });
});

describe("権限", () => {
  it("ログインしていない人も、ログインした人も、読めず・書けない（サーバーだけ）", async () => {
    expect((await anonClient().from("waitlist").select("id").limit(1)).error?.code).toBe("42501");
    expect((await anonClient().from("waitlist").insert({ email: newEmail(), cancel_token_hash: "a".repeat(64) })).error?.code).toBe("42501");
    const { client, userId } = await signUpNewUser();
    expect((await client.from("waitlist").select("id").limit(1)).error?.code).toBe("42501");
    expect((await client.from("waitlist").insert({ email: newEmail(), cancel_token_hash: "b".repeat(64) })).error?.code).toBe("42501");
    await deleteUser(userId);
  });
});

describe("申し込む", () => {
  it("受け付けて確認のメールを送る。同じアドレスでもう一度申し込んでも同じ返事で、メールは送り直さない", async () => {
    const email = newEmail();
    const { sendMail, deps: d } = deps();
    expect(await applyWaitlist(admin, input(email.toUpperCase()), d)).toEqual({ ok: true, mail: "sent" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = (sendMail.mock.calls[0] as unknown as [{ to: string; text: string }])[0];
    expect(mail.to).toBe(email);
    expect(mail.text).toMatch(/https:\/\/yabumi\.test\/waitlist\/cancel\?t=[\w-]+/);
    const { data } = await admin.from("waitlist").select("email, app_note, sns_note, ip_hash").eq("email", email).single();
    expect(data).toMatchObject({ email, app_note: "家計簿のアプリ", sns_note: "X と Threads" });
    expect(data!.ip_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(await applyWaitlist(admin, input(email), d)).toEqual({ ok: true, mail: "none" });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("形の違うアドレス、人に見えない欄に入力があるもの、Turnstile で断られたものは受けない", async () => {
    const { sendMail, deps: d } = deps();
    expect(await applyWaitlist(admin, input("nope"), d)).toEqual({ ok: false, reason: "invalid_email" });
    expect(await applyWaitlist(admin, { ...input(newEmail()), honeypot: "http://spam" }, d)).toEqual({ ok: false, reason: "bot" });
    const verifyTurnstile = vi.fn(async () => false);
    expect(await applyWaitlist(admin, input(newEmail()), { ...d, verifyTurnstile })).toEqual({ ok: false, reason: "bot" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it(`同じ IP からは 1 時間に ${PER_IP_PER_HOUR} 回まで`, async () => {
    const { deps: d } = deps();
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
    const key = randomUUID();
    for (let i = 0; i < PER_IP_PER_HOUR; i++) expect((await applyWaitlist(admin, input(newEmail(), ip), { ...d, hashKey: key })).ok).toBe(true);
    expect(await applyWaitlist(admin, input(newEmail(), ip), { ...d, hashKey: key })).toEqual({ ok: false, reason: "rate_limited" });
  });

  it(`全員を合わせて 1 時間に ${ALL_PER_HOUR} 件まで`, async () => {
    const { deps: d } = deps();
    const { count } = await admin.from("waitlist").select("id", { count: "exact", head: true }).gt("created_at", new Date(Date.now() - 3_600_000).toISOString());
    const rest = Math.max(0, ALL_PER_HOUR - (count ?? 0));
    const fill = Array.from({ length: rest }, () => ({ email: newEmail(), cancel_token_hash: sha256(randomUUID()) }));
    if (fill.length) await admin.from("waitlist").insert(fill);
    expect(await applyWaitlist(admin, input(newEmail()), d)).toEqual({ ok: false, reason: "rate_limited" });
    await admin.from("waitlist").delete().in("email", fill.map((f) => f.email));
  });
});

describe("取り消す・招待する・お断りする", () => {
  it("確認のメールのリンクで取り消すと、すぐに消える。違う合言葉では消えない", async () => {
    const email = newEmail();
    const { sendMail, deps: d } = deps();
    await applyWaitlist(admin, input(email), d);
    const token = new URL((sendMail.mock.calls[0] as unknown as [{ text: string }])[0].text.match(/https:\/\/\S+/)![0]).searchParams.get("t")!;
    expect(await cancelWaitlist(admin, "x".repeat(32))).toBe(false);
    expect(await cancelWaitlist(admin, "../../etc")).toBe(false);
    expect(await cancelWaitlist(admin, token)).toBe(true);
    expect((await admin.from("waitlist").select("id").eq("email", email)).data).toEqual([]);
    expect(await cancelWaitlist(admin, token)).toBe(false);
  });

  it("招待すると、招待のメールを送って（利用者ができる）申し込みを消す。登録済みのアドレスは招待を送らずに消す", async () => {
    const email = newEmail();
    const { deps: d } = deps();
    await applyWaitlist(admin, input(email), d);
    const { data: row } = await admin.from("waitlist").select("id").eq("email", email).single();
    expect(await inviteFromWaitlist(admin, row!.id)).toEqual({ ok: true, already: false });
    expect((await admin.from("waitlist").select("id").eq("id", row!.id)).data).toEqual([]);
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(users.users.some((u) => u.email === email)).toBe(true);

    // 招待を受けて登録を終えた人が、もう一度申し込んだ（招待を受ける前なら、Supabase は招待のメールを送り直す）
    const invited = users.users.find((u) => u.email === email)!;
    await admin.auth.admin.updateUserById(invited.id, { email_confirm: true, password: `pw-${randomUUID()}` });
    await applyWaitlist(admin, input(email), d);
    const { data: again } = await admin.from("waitlist").select("id").eq("email", email).single();
    expect(await inviteFromWaitlist(admin, again!.id)).toEqual({ ok: true, already: true });
    expect((await admin.from("waitlist").select("id").eq("id", again!.id)).data).toEqual([]);
  });

  it("お断りすると、申し込みを消す", async () => {
    const email = newEmail();
    const { deps: d } = deps();
    await applyWaitlist(admin, input(email), d);
    const { data: row } = await admin.from("waitlist").select("id").eq("email", email).single();
    expect(await declineWaitlist(admin, row!.id)).toBe(true);
    expect((await admin.from("waitlist").select("id").eq("id", row!.id)).data).toEqual([]);
    expect(await inviteFromWaitlist(admin, row!.id)).toMatchObject({ ok: false });
  });
});
