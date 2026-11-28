// 「確認して送る」SNS（X など）の押し忘れを防ぐ知らせの時刻（2026-11-28 PM の了承。11/25・26 本番で X の確認が押されず送られなかった）。
// プッシュ（engine.ts の remindApprovals・notifyExpired）とメール（mail.ts の collectAutoNotices）で同じ決まりを使う。時刻は日本の時刻で見る
// - リマインド: 送る 3 時間前。それが夜中（22:00〜翌 8:00）にかかるときは、その前の 21:00 に早める
//   作った知らせ（notified_at）から 1 時間たたないうちなら送らない（続けて鳴らさない）
// - 夜中（22:00〜翌 8:00）は、リマインドも「送れませんでした」の知らせも鳴らさない（朝になってから）

export const REMIND_BEFORE_MS = 3 * 3_600_000;
// 送る時刻の何時間前までを、リマインドの候補として読むか（夜中を避けて早めると、最大で 3 時間＋10 時間 59 分前になる）
export const REMIND_LOOKAHEAD_MS = 14 * 3_600_000;
// 確認できないまま送る時刻を過ぎた配信先の error_message（engine.ts の settleApprovals が入れる。投稿の画面にも出る）。
// DB の send_expired_auto_target（20261129100000）がこの文で見分けるので、変えるときは関数も変える。
// 2026-11-28 に文を変えた（前は「確認できないまま…日時を直して…」）。前の文の行も、頭の部分（EXPIRED_LEGACY_HEAD）で見分ける
export const EXPIRED_MESSAGE = "確認しないまま送る時刻を過ぎたので、送りませんでした。送るときは、日時を変えて確認してください。";
const EXPIRED_LEGACY_HEAD = "確認できないまま送る時刻を過ぎたので";
export const isExpiredTarget = (t: { status: string; error_message?: string | null }) =>
  t.status === "failed" && (t.error_message === EXPIRED_MESSAGE || (t.error_message?.startsWith(EXPIRED_LEGACY_HEAD) ?? false));
// 過ぎてから「今すぐ送る」を押せる長さ（DB の send_expired_auto_target と同じ）
export const EXPIRED_SEND_WINDOW_MS = 24 * 3_600_000;
const QUIET_START = 22;
const QUIET_END = 8;
const EVENING = 21;
const HOUR = 3_600_000;
const JST = 9 * HOUR;

const jstHour = (d: Date) => new Date(d.getTime() + JST).getUTCHours();
export const isQuietHour = (d: Date) => jstHour(d) >= QUIET_START || jstHour(d) < QUIET_END;

// リマインドを送る時刻
export function remindAt(due: Date): Date {
  const at = new Date(due.getTime() - REMIND_BEFORE_MS);
  if (!isQuietHour(at)) return at;
  // その前の 21:00（日本時間）
  const j = new Date(at.getTime() + JST);
  let evening = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), EVENING) - JST;
  if (evening > at.getTime()) evening -= 24 * HOUR;
  return new Date(evening);
}

// send: いま送る / wait: まだ（時刻の前・夜中）/ skip: 送らない（作った知らせのすぐあと）
export function remindDecision(run: { due_at: string; notified_at?: string | null }, now: Date): "send" | "wait" | "skip" {
  const due = new Date(run.due_at);
  if (due.getTime() <= now.getTime()) return "skip";
  const at = remindAt(due);
  if (run.notified_at && at.getTime() < new Date(run.notified_at).getTime() + HOUR) return "skip";
  if (now.getTime() < at.getTime() || isQuietHour(now)) return "wait";
  return "send";
}
