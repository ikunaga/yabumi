import type { SupabaseClient } from "@supabase/supabase-js";
import { type UserMailDeps, type UserMailResult, sendUserMail } from "@/lib/notify/user-mail";
import type { Database } from "@/lib/supabase/database.types";
import { LEGAL, operatorLabel, orPending } from "./info";
import { type LegalRevision, formatLegalDate, noticeStarted, todayJst, upcomingLegalChange } from "./version";

// 利用規約・プライバシーポリシーの変更の知らせを、登録している全員にメールで送る（決定 D31。docs/architecture.md の 4.30）。
// 運営者が /admin/legal-notice で「全員に送る」を押すと送り始め、1 日に送る数（Resend の Free は 1 日 100 通。ほかのメールの分を残す）を
// 超える分は、毎日のジョブ（/api/jobs/legal-notice）が続きを送る。送った記録（legal_notice_sends）で、同じ人に二重に送らない。
// 伴走のお知らせのメールを止めた人にも送る（取引上の大事な知らせで、宣伝ではない。docs/legal.md の D31）

type Db = SupabaseClient<Database>;

// 1 日（日本時間）に、この知らせとして送る数。Resend の Free の 1 日 100 通から、認証・伴走・運営者のメールの分を残す
export const DEFAULT_DAILY_LIMIT = 80;
// 送れなかった人に送り直す回数の上限
export const MAX_ATTEMPTS = 3;
// 1 度に並べて送る数
const CONCURRENCY = 5;

export function dailyLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LEGAL_NOTICE_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : DEFAULT_DAILY_LIMIT;
}

const DOC_LABEL = { terms: "利用規約", privacy: "プライバシーポリシー" } as const;

export function docsLabel(change: LegalRevision): string {
  return change.docs.map((d) => DOC_LABEL[d]).join("・");
}

export function noticeMail(to: string, change: LegalRevision, appUrl: string) {
  const docs = docsLabel(change);
  const links = change.docs.map((d) => `- ${DOC_LABEL[d]}: ${appUrl}/${d}#legal-notice`).join("\n");
  return {
    to,
    subject: `矢書の${docs}の変更のお知らせ`,
    text: [
      "矢書（やぶみ）をご利用いただき、ありがとうございます。",
      "",
      `${formatLegalDate(change.version)}から、矢書の${docs}を変更します。`,
      "",
      "変わる点:",
      ...change.summary.map((s) => `- ${s}`),
      "",
      "くわしくは、次のページの先頭の「変更のお知らせ」をご覧ください。",
      links,
      "",
      `${formatLegalDate(change.version)}以降に矢書を使い続けると、変更後の${docs}に同意したものとして扱います。同意できない場合は、それまでに「アカウント」の画面から退会できます。`,
      "",
      "このメールは、矢書に登録しているすべての方にお送りしている、ご利用の条件に関する大切なお知らせです（伴走のお知らせのメールを止めている方にもお送りしています）。",
      "",
      `送信者: 矢書（${operatorLabel()}）`,
      `お問い合わせ: ${orPending(LEGAL.contact)}`,
    ].join("\n"),
  };
}

export type Recipient = { id: string; email: string };

// 登録している全員（メールアドレスを確かめた人）。1,000 人ずつ読む
export async function listRecipients(admin: Db): Promise<Recipient[]> {
  const out: Recipient[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email && u.email_confirmed_at && !u.banned_until) out.push({ id: u.id, email: u.email });
    if (data.users.length < 1000) break;
  }
  return out;
}

// 日本時間の今日の 0 時（UTC の ISO）
function jstDayStart(now: Date): string {
  return new Date(`${todayJst(now)}T00:00:00+09:00`).toISOString();
}

export type NoticeProgress = { recipients: number; sent: number; failed: number; sending: number; remaining: number; sentToday: number; started: boolean; finished: boolean };

// onlyUserIds: テスト用。数える相手を絞る（共有のローカル DB で、ほかの利用者を数えない）
export async function noticeProgress(admin: Db, version: string, now: Date = new Date(), onlyUserIds?: string[]): Promise<NoticeProgress> {
  const [{ data: campaign }, all, { data: rows, error }] = await Promise.all([
    admin.from("legal_notice_campaigns").select("version, finished_at").eq("version", version).maybeSingle(),
    listRecipients(admin),
    admin.from("legal_notice_sends").select("user_id, status, attempts, updated_at").eq("version", version),
  ]);
  if (error) throw error;
  const recipients = onlyUserIds ? all.filter((r) => onlyUserIds.includes(r.id)) : all;
  const byUser = new Map((rows ?? []).map((r) => [r.user_id, r]));
  const dayStart = jstDayStart(now);
  let sent = 0;
  let failed = 0;
  let sending = 0;
  let remaining = 0;
  for (const r of recipients) {
    const row = byUser.get(r.id);
    if (!row) remaining++;
    else if (row.status === "sent") sent++;
    else if (row.status === "sending") sending++;
    else {
      failed++;
      if (row.attempts < MAX_ATTEMPTS) remaining++;
    }
  }
  const sentToday = (rows ?? []).filter((r) => (!onlyUserIds || onlyUserIds.includes(r.user_id)) && r.updated_at >= dayStart && r.status !== "failed").length;
  return { recipients: recipients.length, sent, failed, sending, remaining, sentToday, started: Boolean(campaign), finished: Boolean(campaign?.finished_at) };
}

export type SendDeps = {
  now?: () => Date;
  appUrl: string;
  limit?: number;
  mail?: UserMailDeps;
  sendMail?: (mail: ReturnType<typeof noticeMail>, deps?: UserMailDeps) => Promise<UserMailResult>;
  deadlineMs?: number;
  // テスト用。送る相手と、1 日の数を数える範囲を絞る（共有のローカル DB で、ほかの利用者に送らない）
  onlyUserIds?: string[];
};
export type SendOutcome = { version: string | null; sent: number; failed: number; skipped: number; remaining: number; reason?: "no_change" | "not_started" | "not_noticing" | "daily_limit" | "deadline" | "done" };

// 1 人分を取る（送った記録を先に作る。同じ人に同時に 2 つの送り手が来ても、片方だけが送る）
async function claim(admin: Db, version: string, userId: string, existing: { status: string; attempts: number } | undefined): Promise<boolean> {
  if (!existing) {
    const { error } = await admin.from("legal_notice_sends").insert({ version, user_id: userId });
    return !error;
  }
  if (existing.status !== "failed" || existing.attempts >= MAX_ATTEMPTS) return false;
  const { data } = await admin
    .from("legal_notice_sends")
    .update({ status: "sending", attempts: existing.attempts + 1, updated_at: new Date().toISOString() })
    .eq("version", version)
    .eq("user_id", userId)
    .eq("status", "failed")
    .eq("attempts", existing.attempts)
    .select("user_id");
  return Boolean(data?.length);
}

// 送り始めた（運営者が押した）予定の変更の知らせを、今日の残りの数まで送る。運営者の「全員に送る」と、毎日のジョブから呼ぶ
export async function sendLegalNoticeBatch(admin: Db, deps: SendDeps, change: LegalRevision | null = upcomingLegalChange(deps.now?.() ?? new Date())): Promise<SendOutcome> {
  const now = deps.now?.() ?? new Date();
  const empty = { sent: 0, failed: 0, skipped: 0, remaining: 0 };
  // 施行日を過ぎた変更の知らせは送らない（予定の変更がなくなる）
  if (!change) return { version: null, ...empty, reason: "no_change" };
  if (!noticeStarted(change, now)) return { version: change.version, ...empty, reason: "not_noticing" };
  const { data: campaign } = await admin.from("legal_notice_campaigns").select("version, finished_at").eq("version", change.version).maybeSingle();
  if (!campaign) return { version: change.version, ...empty, reason: "not_started" };

  const limit = deps.limit ?? dailyLimit();
  let todayQuery = admin.from("legal_notice_sends").select("user_id", { count: "exact", head: true }).gte("updated_at", jstDayStart(now)).neq("status", "failed");
  if (deps.onlyUserIds) todayQuery = todayQuery.in("user_id", deps.onlyUserIds);
  const { count: today } = await todayQuery;
  let budget = limit - (today ?? 0);

  const [recipients, { data: rows }] = await Promise.all([listRecipients(admin), admin.from("legal_notice_sends").select("user_id, status, attempts").eq("version", change.version)]);
  const byUser = new Map((rows ?? []).map((r) => [r.user_id, r]));
  const targets = recipients.filter((r) => {
    if (deps.onlyUserIds && !deps.onlyUserIds.includes(r.id)) return false;
    const row = byUser.get(r.id);
    return !row || (row.status === "failed" && row.attempts < MAX_ATTEMPTS);
  });

  const out: SendOutcome = { version: change.version, ...empty };
  const send = deps.sendMail ?? sendUserMail;
  let i = 0;
  while (i < targets.length) {
    if (budget <= 0) {
      out.reason = "daily_limit";
      break;
    }
    if (deps.deadlineMs && Date.now() > deps.deadlineMs) {
      out.reason = "deadline";
      break;
    }
    const chunk = targets.slice(i, i + Math.min(CONCURRENCY, budget));
    i += chunk.length;
    await Promise.all(
      chunk.map(async (r) => {
        if (!(await claim(admin, change.version, r.id, byUser.get(r.id)))) {
          out.skipped++;
          return;
        }
        budget--;
        const result = await send(noticeMail(r.email, change, deps.appUrl), deps.mail).catch(() => "failed" as const);
        const ok = result === "sent";
        await admin
          .from("legal_notice_sends")
          .update({ status: ok ? "sent" : "failed", updated_at: new Date().toISOString() })
          .eq("version", change.version)
          .eq("user_id", r.id);
        if (ok) out.sent++;
        else out.failed++;
      }),
    );
  }
  // まだ送っていない人（今回の上限で残った人と、失敗してやり直せる人）を数え直す
  const progress = await noticeProgress(admin, change.version, now, deps.onlyUserIds);
  out.remaining = progress.remaining;
  if (!out.reason) out.reason = "done";
  if (progress.remaining === 0 && progress.sending === 0 && !campaign.finished_at) {
    await admin.from("legal_notice_campaigns").update({ finished_at: new Date().toISOString() }).eq("version", change.version);
  }
  return out;
}

// 運営者が「全員に送る」を押した: 送り始めた記録を作り、今日の分を送る
export async function startLegalNotice(admin: Db, deps: SendDeps, change: LegalRevision | null = upcomingLegalChange(deps.now?.() ?? new Date())): Promise<SendOutcome> {
  const now = deps.now?.() ?? new Date();
  if (!change) return { version: null, sent: 0, failed: 0, skipped: 0, remaining: 0, reason: "no_change" };
  if (!noticeStarted(change, now)) return { version: change.version, sent: 0, failed: 0, skipped: 0, remaining: 0, reason: "not_noticing" };
  await admin.from("legal_notice_campaigns").upsert({ version: change.version }, { onConflict: "version", ignoreDuplicates: true });
  return sendLegalNoticeBatch(admin, deps, change);
}
