// 利用規約・プライバシーポリシーの変更の知らせを全員に送る（決定 D31。docs/architecture.md の 4.30）。
// 二重に送らない、1 日の上限で日を分ける、送れなかった人に送り直す、送り始める前・知らせる前は送らない、権限。
// メールは送らない（送る部品を差し替える）。送る相手はテストの利用者に絞る（共有のローカル DB のほかの利用者に送らない）
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, noticeMail, noticeProgress, sendLegalNoticeBatch, startLegalNotice } from "@/lib/legal/notice-mail";
import type { LegalRevision } from "@/lib/legal/version";
import { adminClient, anonClient, deleteUser, signUpNewUser } from "./helpers/supabase";

const admin = adminClient();
const users: { id: string; client: Awaited<ReturnType<typeof signUpNewUser>>["client"] }[] = [];
const versions: string[] = [];

// テストごとに別の版（遠い先の施行日）。知らせ始める日は過去
let seq = 0;
function change(over: Partial<LegalRevision> = {}): LegalRevision {
  seq += 1;
  const version = `2099-${String((Date.now() % 9) + 1).padStart(2, "0")}-${String(seq + 10).padStart(2, "0")}`;
  versions.push(version);
  return { version, docs: ["terms", "privacy"], summary: ["送り先に Google を足す"], adverse: false, noticeFrom: "2026-01-01", ...over };
}

function mailer(fail: Set<string> = new Set()) {
  const to: string[] = [];
  const sendMail = vi.fn(async (m: { to: string }) => {
    to.push(m.to);
    return fail.has(m.to) ? ("failed" as const) : ("sent" as const);
  });
  return { sendMail, to };
}

let ids: string[] = [];
let emails: Map<string, string>;

beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    const u = await signUpNewUser();
    users.push({ id: u.userId, client: u.client });
  }
  ids = users.map((u) => u.id);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  emails = new Map(data.users.filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email!]));
});

afterAll(async () => {
  await admin.from("legal_notice_campaigns").delete().in("version", versions);
  for (const u of users) await deleteUser(u.id);
});

describe("権限", () => {
  it("ログインしていない人も、ログインした人も、送った記録を読めず書けない", async () => {
    expect((await anonClient().from("legal_notice_sends").select("user_id").limit(1)).error?.code).toBe("42501");
    expect((await users[0].client.from("legal_notice_sends").select("user_id").limit(1)).error?.code).toBe("42501");
    expect((await users[0].client.from("legal_notice_campaigns").insert({ version: "2099-01-01" })).error?.code).toBe("42501");
  });
});

describe("送る", () => {
  it("運営者が押す前・知らせ始める日の前・予定の変更がないときは送らない", async () => {
    const { sendMail } = mailer();
    const c = change();
    expect(await sendLegalNoticeBatch(admin, { appUrl: "https://yabumi.test", sendMail, onlyUserIds: ids }, c)).toMatchObject({ reason: "not_started", sent: 0 });
    expect(await startLegalNotice(admin, { appUrl: "https://yabumi.test", sendMail, onlyUserIds: ids }, change({ noticeFrom: "2098-12-01" }))).toMatchObject({ reason: "not_noticing", sent: 0 });
    expect(await startLegalNotice(admin, { appUrl: "https://yabumi.test", sendMail, onlyUserIds: ids }, null)).toMatchObject({ reason: "no_change" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("押すと全員に 1 通ずつ送り、もう一度押しても、ジョブが来ても二重に送らない", async () => {
    const { sendMail, to } = mailer();
    const c = change();
    const deps = { appUrl: "https://yabumi.test", sendMail, onlyUserIds: ids, limit: 100 };
    expect(await startLegalNotice(admin, deps, c)).toMatchObject({ sent: 3, failed: 0, remaining: 0, reason: "done" });
    expect(to.sort()).toEqual([...emails.values()].sort());
    expect(await startLegalNotice(admin, deps, c)).toMatchObject({ sent: 0 });
    expect(await sendLegalNoticeBatch(admin, deps, c)).toMatchObject({ sent: 0 });
    // 同時に 2 つ動いても、1 人に 1 通
    const c2 = change();
    await admin.from("legal_notice_campaigns").insert({ version: c2.version });
    const [a, b] = await Promise.all([sendLegalNoticeBatch(admin, deps, c2), sendLegalNoticeBatch(admin, deps, c2)]);
    expect(a.sent + b.sent).toBe(3);
    expect(sendMail).toHaveBeenCalledTimes(6);
    const { data } = await admin.from("legal_notice_campaigns").select("finished_at").eq("version", c.version).single();
    expect(data!.finished_at).not.toBeNull();
  });

  it("1 日の上限を超える分は、次の日のジョブで続きを送る", async () => {
    const { sendMail } = mailer();
    const c = change();
    const today = new Date();
    // 1 日の数は、版にかかわらず今日送った数で数える（前のテストで同じ利用者に今日送った分を足して、今日あと 2 通にする）
    const dayStart = new Date(`${new Date(today.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+09:00`).toISOString();
    const { count } = await admin.from("legal_notice_sends").select("user_id", { count: "exact", head: true }).in("user_id", ids).gte("updated_at", dayStart).neq("status", "failed");
    const deps = { appUrl: "https://yabumi.test", sendMail, onlyUserIds: ids, limit: (count ?? 0) + 2, now: () => today };
    expect(await startLegalNotice(admin, deps, c)).toMatchObject({ sent: 2, remaining: 1, reason: "daily_limit" });
    // 同じ日にもう一度: 上限に達しているので送らない
    expect(await sendLegalNoticeBatch(admin, deps, c)).toMatchObject({ sent: 0, remaining: 1, reason: "daily_limit" });
    // 次の日（日本時間）
    const tomorrow = new Date(today.getTime() + 86_400_000);
    expect(await sendLegalNoticeBatch(admin, { ...deps, now: () => tomorrow }, c)).toMatchObject({ sent: 1, remaining: 0, reason: "done" });
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(await noticeProgress(admin, c.version, tomorrow, ids)).toMatchObject({ recipients: 3, sent: 3, remaining: 0 });
  });

  it(`送れなかった人には、次の回に送り直す（${MAX_ATTEMPTS} 回まで）`, async () => {
    const c = change();
    const failing = emails.get(ids[0])!;
    const { sendMail } = mailer(new Set([failing]));
    const deps = { appUrl: "https://yabumi.test", sendMail, onlyUserIds: ids, limit: 100 };
    expect(await startLegalNotice(admin, deps, c)).toMatchObject({ sent: 2, failed: 1, remaining: 1 });
    expect(await sendLegalNoticeBatch(admin, deps, c)).toMatchObject({ sent: 0, failed: 1, remaining: 1 });
    expect(await sendLegalNoticeBatch(admin, deps, c)).toMatchObject({ sent: 0, failed: 1, remaining: 0 });
    // 3 回で止める
    expect(await sendLegalNoticeBatch(admin, deps, c)).toMatchObject({ sent: 0, failed: 0 });
    expect(sendMail.mock.calls.filter(([m]) => m.to === failing)).toHaveLength(MAX_ATTEMPTS);
  });
});

describe("メールの中身", () => {
  it("施行日・変わる点・ページへのリンク・送信者・問い合わせ先を書く", () => {
    const m = noticeMail("a@example.com", { version: "2026-11-20", docs: ["privacy"], summary: ["送り先に Google を足す"], adverse: false, noticeFrom: "2026-11-01" }, "https://yabumi.app");
    expect(m.subject).toBe("矢書のプライバシーポリシーの変更のお知らせ");
    expect(m.text).toContain("2026年11月20日から");
    expect(m.text).toContain("- 送り先に Google を足す");
    expect(m.text).toContain("https://yabumi.app/privacy#legal-notice");
    expect(m.text).toContain("送信者: 矢書");
    expect(m.text).toContain("お問い合わせ:");
  });
});
