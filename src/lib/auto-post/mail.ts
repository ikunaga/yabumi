import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePrefs } from "@/lib/coach/notify";
import { LEGAL } from "@/lib/legal/info";
import { sendUserMail, type UserMailDeps, type UserMailResult } from "@/lib/notify/user-mail";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { STOP_REASON_TEXT } from "./labels";
import type { AutoStopReason } from "./types";

// 自動投稿の大事な知らせのメール（2026-11-23 オーナーの指示「メールでも送れるようにして」。PM が案を了承。docs/design/auto-post.md の 2.7）。
// スマホの通知とは別に選び、ジョブの 1 回ごとに 1 人 1 通にまとめる。送るのは次のものだけ（「予約しました」だけの知らせは送らない。多すぎるため）:
// - held: 下書きに残した回 / review: 1 回目の確認待ちの回 / remind: 確認待ちのまま送る時刻の 2 時間前になった回
// - stop: yabumi が回し方を止めた（利用者が自分で止めたときは送らない）/ hold・release: 運営者が自動投稿を止めた・解除した
// 中身は、プロジェクトと回し方の名前・送る日時・SNS の名前・止まった理由・画面へのリンクだけ（投稿の本文は入れない。docs/legal.md の ② の案）。
// 同じ知らせは notification_log（channel = email）で 1 回だけ。送れなかったら記録を消し、次のジョブでまた送る（送る時刻を過ぎた回は送らない）。
// お知らせの設定で「メールで受け取らない」にした人（auto_post_email = false）には、どれも送らない（運営者が止めた知らせも。画面の帯で知らせている。PM の判断）
type Db = SupabaseClient<Database>;

// 自動投稿のメールを送るか（環境変数 AUTO_POST_MAIL=on）。規約の変更（docs/legal.md の ② の案）の施行まで本番では送らないため、既定は送らない。
// 送らない間は、お知らせの設定にもメールの選択を出さない
export function autoPostMailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTO_POST_MAIL === "on";
}

// auto_failed: 回を作れなかった（やり直しても駄目で飛ばした。2026-11-24 から）
export type AutoMailKind = "auto_held" | "auto_review" | "auto_remind" | "auto_stop" | "auto_hold" | "auto_release" | "auto_failed";
export type AutoNotice = {
  kind: AutoMailKind;
  ownerId: string;
  // 運営者が止めた・解除したときは null（プロジェクトに結びつかない）
  projectId: string | null;
  projectName: string;
  key: string;
  planName: string;
  dueAt?: Date;
  sns?: SnsKey[];
  reason?: string;
  // 止まった理由のあとの、次にすること
  next?: string;
  // 同じ回の知らせを 1 行にまとめるための回の id（remind は、同じメールに held・review があれば行を出さない）
  runId?: string;
};

// 確かめ待ちのまま、送る時刻の何時間前に知らせるか（engine.ts の remindApprovals と同じ）
export const MAIL_REMIND_BEFORE_MS = 2 * 3_600_000;
// 止めた・運営者の知らせを、何日前のものまで送るか（ジョブが止まっていたあとに、古い知らせをまとめて送らない）
const RECENT_MS = 3 * 86_400_000;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// 「11月24日 火曜 9:00」（日本時間）
export function jstDateTime(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  return `${j.getUTCMonth() + 1}月${j.getUTCDate()}日 ${WEEKDAYS[j.getUTCDay()]}曜 ${j.getUTCHours()}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}
const snsText = (sns: SnsKey[] | undefined) => SNS_KEYS.filter((k) => sns?.includes(k)).map((s) => SNS[s].label).join("・");

// 止まった理由のあとに付ける、次にすること（yabumi が止めたとき。STOP_REASON_TEXT は画面と同じ文）
const STOP_NEXT: Partial<Record<AutoStopReason, string>> = {
  fail_streak: "理由を画面で確認してから、再開してください。",
  disconnected: "SNS をつなぎ直してから、再開してください。",
  materials_out: "投稿のもとを追加してから、再開してください。",
};

// 運営者が止めた・解除したときの文（メールだけ。スマホの通知は holds.ts の HOLD_PUSH・RELEASE_PUSH。理由は入れない）
export const HOLD_MAIL = ["yabumi の運営が、あなたの自動投稿を止めました。", "止めている間は、新しい投稿はつくりません。", "理由は、問い合わせ先にお尋ねください。"];
export const RELEASE_MAIL = ["yabumi の運営が止めていた自動投稿を、また使えるようにしました。", "次の投稿は、あなたが確認するまで送りません。"];

export function noticeLine(n: AutoNotice): string {
  const at = n.dueAt ? jstDateTime(n.dueAt) : "";
  const to = snsText(n.sns);
  switch (n.kind) {
    case "auto_review":
      return `・「${n.planName}」${at} に ${to} に送る 1 回目の投稿です。確認するまで送りません。`;
    case "auto_remind":
      return `・「${n.planName}」${at} に ${to} に送る投稿を、まだ確認していません。確認するまで送りません。`;
    case "auto_held":
      return `・「${n.planName}」${at} の ${to} の投稿は、送らずに下書きに残しました。送るときは、確認して予約し直してください。`;
    case "auto_stop":
      return `・「${n.planName}」: ${[n.reason, n.next].filter(Boolean).join("。")}`;
    case "auto_failed":
      return `・「${n.planName}」${at} の投稿は、作れませんでした。${to} には送っていません。次の投稿は、いつもどおり送ります。`;
    case "auto_hold":
      return HOLD_MAIL.join("");
    case "auto_release":
      return RELEASE_MAIL.join("");
  }
}

const SECTIONS: { title: string; kinds: AutoMailKind[] }[] = [
  { title: "止まっている自動投稿", kinds: ["auto_stop"] },
  { title: "確認が要る投稿", kinds: ["auto_review", "auto_remind"] },
  { title: "下書きに残した投稿", kinds: ["auto_held"] },
  { title: "作れなかった投稿", kinds: ["auto_failed"] },
];

export type MailContext = { appUrl: string; unsubscribeToken: string };

// メールの最後に付ける: 何のメールか、設定の変え方、ワンクリックの配信の停止、送信者と問い合わせ先（特定電子メール法の表示に沿う。伴走のメールと同じ形）
export function autoMailFooter(c: MailContext): string {
  return [
    "--",
    "yabumi から、自動投稿についてお知らせするメールです。",
    "確認が要るとき・下書きに残したとき・止まったときに送ります。",
    `メールの受け取り方を変える: ${c.appUrl}/settings/notifications`,
    `自動投稿のメールを止める: ${c.appUrl}/unsubscribe?t=${c.unsubscribeToken}&k=auto`,
    `送信者: yabumi・運営 ${LEGAL.operator ?? "yabumi の運営"}`,
    `問い合わせ: ${LEGAL.contact ?? `${c.appUrl}/privacy`}`,
  ].join("\n");
}

// RFC 8058 のワンクリックの配信の停止。止まるのは自動投稿のメールだけ（伴走のメールは止めない）
export function autoUnsubscribeHeaders(c: MailContext): Record<string, string> {
  return {
    "List-Unsubscribe": `<${c.appUrl}/api/unsubscribe?t=${c.unsubscribeToken}&k=auto>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// 1 人に 1 通の件名と本文（テストで中身を確かめる）。件名は、中の 1 番重い知らせで決める
export function autoMail(notices: AutoNotice[], c: MailContext): { subject: string; text: string } {
  const has = (k: AutoMailKind) => notices.some((n) => n.kind === k);
  const subject =
    has("auto_hold") || has("auto_stop")
      ? "yabumi: 自動投稿が止まっています"
      : has("auto_review") || has("auto_remind")
        ? "yabumi: 自動投稿の確認をお願いします"
        : has("auto_held")
          ? "yabumi: 自動投稿を送らずに下書きに残しました"
          : has("auto_failed")
            ? "yabumi: 自動投稿を 1 本、送れませんでした"
          : "yabumi: 自動投稿をまた使えるようになりました";
  const lines = ["自動投稿についてのお知らせです。"];
  // 運営者が止めた・解除した（プロジェクトに結びつかない）
  for (const n of notices.filter((n) => n.projectId === null)) lines.push("", noticeLine(n), `yabumi を開く: ${c.appUrl}/projects`);
  // プロジェクトごと
  const shown = new Set(notices.filter((n) => n.kind === "auto_held" || n.kind === "auto_review").map((n) => n.runId));
  const projects = [...new Set(notices.filter((n) => n.projectId).map((n) => n.projectId!))];
  for (const p of projects) {
    const mine = notices.filter((n) => n.projectId === p && !(n.kind === "auto_remind" && shown.has(n.runId)));
    lines.push("", `■ ${mine[0]?.projectName ?? notices.find((n) => n.projectId === p)!.projectName}`);
    for (const s of SECTIONS) {
      const items = mine.filter((n) => s.kinds.includes(n.kind));
      if (!items.length) continue;
      lines.push(s.title, ...items.map(noticeLine));
    }
    lines.push(`確認する: ${c.appUrl}/projects/${p}/auto`);
  }
  lines.push("", autoMailFooter(c));
  return { subject, text: lines.join("\n") };
}

type RunRow = {
  id: string;
  owner_id: string;
  project_id: string;
  due_at: string;
  status: string;
  auto_plans: { name: string; targets: unknown } | null;
  projects: { name: string } | null;
  posts: { post_targets: { sns: string; status: string }[] } | null;
};
type Scope = { ownerIds?: string[] };
const scoped = <Q extends { in: (col: string, v: string[]) => Q }>(q: Q, opts: Scope, col = "owner_id"): Q => (opts.ownerIds ? q.in(col, opts.ownerIds) : q);
const planSns = (r: RunRow): SnsKey[] => {
  const t = r.auto_plans?.targets;
  return t && typeof t === "object" ? (Object.keys(t) as SnsKey[]) : (r.posts?.post_targets ?? []).map((x) => x.sns as SnsKey);
};
const RUN_SELECT = "id, owner_id, project_id, due_at, status, auto_plans!auto_runs_plan_id_fkey(name, targets), projects(name), posts!auto_runs_post_id_fkey(post_targets(sns, status))";

// まだメールで送っていないかは、送るときに notification_log で確かめる（ここは候補を集めるだけ）
export async function collectAutoNotices(admin: Db, now: Date, opts: Scope = {}): Promise<AutoNotice[]> {
  const out: AutoNotice[] = [];
  const iso = now.toISOString();
  const runNotice = (r: RunRow, kind: AutoMailKind, sns: SnsKey[]): AutoNotice => ({
    kind,
    ownerId: r.owner_id,
    projectId: r.project_id,
    projectName: r.projects?.name ?? "",
    key: r.id,
    planName: r.auto_plans?.name ?? "",
    dueAt: new Date(r.due_at),
    sns,
    runId: r.id,
  });

  // 下書きに残した回・1 回目の確認待ちの回（送る時刻の前のものだけ）
  const { data: made, error: e1 } = await scoped(admin.from("auto_runs").select(RUN_SELECT).in("status", ["held", "review"]).gt("due_at", iso).not("post_id", "is", null), opts);
  if (e1) throw e1;
  for (const r of made as unknown as RunRow[]) out.push(runNotice(r, r.status === "held" ? "auto_held" : "auto_review", planSns(r)));

  // 作れなかった回（やり直しても駄目で飛ばした。engine.ts の failRun）。ジョブが止まっていたあとに古いものをまとめて送らないよう、3 日まで
  const { data: failed, error: e5 } = await scoped(
    admin.from("auto_runs").select(RUN_SELECT).eq("status", "skipped").eq("reason", "error").gt("updated_at", new Date(now.getTime() - RECENT_MS).toISOString()),
    opts,
  );
  if (e5) throw e5;
  for (const r of failed as unknown as RunRow[]) out.push(runNotice(r, "auto_failed", planSns(r)));

  // 確認待ちのまま、送る時刻の 2 時間前になった回（1 回目の確認待ち、または送り先のどれかが確認待ち）。運営者が止めている人には促さない
  const { data: soon, error: e2 } = await scoped(
    admin
      .from("auto_runs")
      .select(RUN_SELECT)
      .in("status", ["scheduled", "review"])
      .gt("due_at", iso)
      .lte("due_at", new Date(now.getTime() + MAIL_REMIND_BEFORE_MS).toISOString()),
    opts,
  );
  if (e2) throw e2;
  const soonRows = soon as unknown as RunRow[];
  const owners = [...new Set(soonRows.map((r) => r.owner_id))];
  const { data: holding } = owners.length ? await admin.from("auto_post_holds").select("user_id").in("user_id", owners).is("released_at", null) : { data: [] };
  const held = new Set((holding ?? []).map((h) => h.user_id));
  for (const r of soonRows) {
    if (held.has(r.owner_id)) continue;
    const waiting = (r.posts?.post_targets ?? []).filter((t) => t.status === "awaiting_approval").map((t) => t.sns as SnsKey);
    if (r.status !== "review" && !waiting.length) continue;
    out.push(runNotice(r, "auto_remind", r.status === "review" ? planSns(r) : waiting));
  }

  // yabumi が止めた回し方（止めた理由が入っているもの。利用者が自分で止めたときは stop_reason が空）
  const recent = new Date(now.getTime() - RECENT_MS).toISOString();
  const { data: stopped, error: e3 } = await scoped(
    admin.from("auto_plans").select("id, owner_id, project_id, name, stop_reason, updated_at, projects(name)").eq("status", "stopped").not("stop_reason", "is", null).gt("updated_at", recent),
    opts,
  );
  if (e3) throw e3;
  for (const p of stopped as unknown as { id: string; owner_id: string; project_id: string; name: string; stop_reason: AutoStopReason; updated_at: string; projects: { name: string } | null }[]) {
    out.push({
      kind: "auto_stop",
      ownerId: p.owner_id,
      projectId: p.project_id,
      projectName: p.projects?.name ?? "",
      key: `${p.id}:${new Date(p.updated_at).getTime()}`,
      planName: p.name,
      reason: (STOP_REASON_TEXT[p.stop_reason] ?? "止まりました").replace(/。$/, ""),
      next: STOP_NEXT[p.stop_reason],
    });
  }

  // 運営者が止めた・解除した（理由は入れない。決まった文だけ）
  const { data: holds, error: e4 } = await scoped(admin.from("auto_post_holds").select("id, user_id, held_at, released_at").or(`held_at.gt."${recent}",released_at.gt."${recent}"`), opts, "user_id");
  if (e4) throw e4;
  // 解除の知らせは、止めた知らせをメールで送った人にだけ送る（スマホの通知と同じ。知らせる前に解除したら、どちらも送らない）
  const releasedIds = holds.filter((h) => h.released_at).map((h) => h.id);
  const { data: heldMailed } = releasedIds.length
    ? await admin.from("notification_log").select("period_key").eq("kind", "auto_hold").eq("channel", "email").in("period_key", releasedIds)
    : { data: [] };
  const mailed = new Set((heldMailed ?? []).map((r) => r.period_key));
  for (const h of holds) {
    const base = { ownerId: h.user_id, projectId: null, projectName: "", key: h.id, planName: "" };
    if (!h.released_at) out.push({ ...base, kind: "auto_hold" });
    else if (mailed.has(h.id) && new Date(h.released_at).getTime() > now.getTime() - RECENT_MS) out.push({ ...base, kind: "auto_release" });
  }
  return out;
}

export type AutoMailDeps = { mail?: UserMailDeps; appUrl?: string; email?: (userId: string) => Promise<string | null> };
export type AutoMailSummary = { sent: number; failed: number };

async function claim(admin: Db, n: AutoNotice[]): Promise<{ id: number; notice: AutoNotice }[]> {
  const rows = n.map((x) => ({ user_id: x.ownerId, project_id: x.projectId, kind: x.kind, period_key: x.key, channel: "email" }));
  const { data, error } = await admin
    .from("notification_log")
    .upsert(rows, { onConflict: "user_id,project_id,kind,period_key,channel", ignoreDuplicates: true })
    .select("id, project_id, kind, period_key");
  if (error) throw error;
  return (data ?? []).flatMap((d) => {
    const notice = n.find((x) => x.kind === d.kind && x.key === d.period_key && x.projectId === d.project_id);
    return notice ? [{ id: d.id, notice }] : [];
  });
}

// ジョブの 1 回ごとに呼ぶ。1 人に 1 通（新しい知らせがあるときだけ）
export async function mailAutoNotices(admin: Db, now: Date, deps: AutoMailDeps = {}, opts: Scope = {}): Promise<AutoMailSummary> {
  const notices = await collectAutoNotices(admin, now, opts);
  const byOwner = new Map<string, AutoNotice[]>();
  for (const n of notices) byOwner.set(n.ownerId, [...(byOwner.get(n.ownerId) ?? []), n]);
  const appUrl = (deps.appUrl ?? process.env.APP_URL ?? "https://localhost:3100").replace(/\/$/, "");
  const summary: AutoMailSummary = { sent: 0, failed: 0 };
  for (const [owner, mine] of byOwner) {
    const { data: pref } = await admin.from("notification_prefs").select("auto_post_email").eq("user_id", owner).maybeSingle();
    if (pref && pref.auto_post_email === false) continue;
    const email = deps.email ? await deps.email(owner) : ((await admin.auth.admin.getUserById(owner)).data.user?.email ?? null);
    if (!email) continue;
    const claimed = await claim(admin, mine);
    if (!claimed.length) continue;
    const prefs = await ensurePrefs(admin, owner);
    const c = { appUrl, unsubscribeToken: prefs.unsubscribe_token };
    const mail = autoMail(
      claimed.map((x) => x.notice),
      c,
    );
    let result: UserMailResult = "failed";
    try {
      result = await sendUserMail({ to: email, ...mail, headers: autoUnsubscribeHeaders(c) }, deps.mail);
    } finally {
      // 送れなかったら（鍵がない・失敗）記録を消し、次のジョブでまた送れるようにする
      if (result !== "sent") await admin.from("notification_log").delete().in("id", claimed.map((x) => x.id));
    }
    if (result === "sent") summary.sent++;
    else summary.failed++;
  }
  return summary;
}
