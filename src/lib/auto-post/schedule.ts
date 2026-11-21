import type { AutoSchedule } from "./types";

// くり返しの規則から、送る時刻を出す（日本時間。日本は夏時間がないので、+9 時間で数える）。
// ジョブが 14 日先までの回を作るのと、画面の「次の回」「月の見込み」に使う

const DAY_MS = 86_400_000;
const JST_MS = 9 * 3_600_000;

// 日本時間の日付（YYYY-MM-DD）の 0 時を、日の通し番号（1970-01-01 から何日目）にする
function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);
}

// 通し番号の日の ISO の曜日（1 = 月〜7 = 日）。1970-01-01 は木曜
function isoWeekday(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

// 送る時刻（from より後、until まで）。数え始めの日（start）より前は出さない。every_weeks は、start の週（月曜始まり）から数える
export function dueTimes(schedule: AutoSchedule, from: Date, until: Date): Date[] {
  const [h, m] = schedule.time.split(":").map(Number);
  const startDay = dayNumber(schedule.start);
  const startMonday = startDay - (isoWeekday(startDay) - 1);
  const firstDay = Math.max(startDay, Math.floor((from.getTime() + JST_MS) / DAY_MS));
  const lastDay = Math.floor((until.getTime() + JST_MS) / DAY_MS);
  const weekdays = new Set(schedule.weekdays);
  const out: Date[] = [];
  for (let day = firstDay; day <= lastDay; day++) {
    if (!weekdays.has(isoWeekday(day))) continue;
    const monday = day - (isoWeekday(day) - 1);
    if (Math.round((monday - startMonday) / 7) % schedule.every_weeks !== 0) continue;
    const at = new Date(day * DAY_MS + (h * 60 + m) * 60_000 - JST_MS);
    if (at > from && at <= until) out.push(at);
  }
  return out;
}

// 次の回（なければ null）。90 日先まで探す
export function nextDueTime(schedule: AutoSchedule, from: Date = new Date()): Date | null {
  return dueTimes(schedule, from, new Date(from.getTime() + 90 * DAY_MS))[0] ?? null;
}

// 30 日あたりの回数の見込み（画面の「月 約 n 本」。4 週ごとの規則でも、ならした数）
export function runsPerMonth(schedule: AutoSchedule): number {
  return Math.round(((schedule.weekdays.length / schedule.every_weeks) * 30) / 7);
}

// 編集したとき、新しい設定で作る最初の投稿の日時。もう作った投稿の日時（made）は飛ばす（同じ日時の回は作り直さない。addUpcomingRuns の重なりの扱い）
export function firstNewDueTime(schedule: AutoSchedule, madeDueAts: string[], now: Date = new Date()): Date | null {
  const made = new Set(madeDueAts.map((d) => new Date(d).getTime()));
  return dueTimes(schedule, now, new Date(now.getTime() + 120 * 86_400_000)).find((d) => !made.has(d.getTime())) ?? null;
}
