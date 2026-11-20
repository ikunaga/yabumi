// 遅れて届く数字（ストアのダウンロード・ストアのページの閲覧）の期間の決め方と書き方。
// ストアの数字は数日遅れて届くので、今日で終わる期間で数えると届いていない日を 0 として足し、減ったように見える（正しくない数字を見せない）。
// そこで、すべてのストアから届いているいちばん新しい日（arrivedUntil）で終わる期間で数え、「10/30 までの 7 日」と終わりの日を書く
import type { WeekValue } from "@/lib/metrics/queries";
import { addDays } from "@/lib/time";

// 「10/30」（overview/numbers.ts の shortDay と同じ。あちらがこのファイルを読むので、ここでは持つ）
function shortDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export const NOT_ARRIVED = "まだ届いていません";

// 数える期間の終わり。届いている日が今日より前ならその日、そうでなければ今日
export function storeEnd(today: string, until: string | null): string {
  return until && until < today ? until : today;
}

// 前の期間の始まり（end から 2 × days − 1 日前）より前から数えていれば、比べられる
export function storePrevKnown(since: string | null, end: string, days: number): boolean {
  return since !== null && since <= addDays(end, -(days * 2 - 1));
}

// 期間の書き方（「直近 7 日」「10/30 までの 7 日」）
export function periodLabel(days: number, until?: string): string {
  return until ? `${shortDay(until)} までの ${days} 日` : `直近 ${days} 日`;
}

// 比べの書き方（「先週比」「前の 30 日比」、終わりの日があれば「その前の 7 日比」）
export function compareLabel(days: number, until?: string): string {
  if (until) return `その前の ${days} 日比`;
  return days === 7 ? "先週比" : `前の ${days} 日比`;
}

// 前の期間と比べられないときの書き方（2026-11-21 オーナーの「前の記録はまだありません、って何？」）。
// 期間の文と、比べられるようになる日の文の 2 文にする（ja-copy-reviewer: 1 文に 2 つのことを入れない）。
// 「直近 30 日の数です。前の 30 日との比べは 1 月 19 日から出ます」。年が変わるなら「来年 1 月 19 日」。日がわからなければ「前の 30 日の記録はまだありません」
export function notComparedLabel(period: string, days: number, from?: string, today?: string): string {
  if (!from) return `${period}の数です。前の ${days} 日の記録はまだありません`;
  const [y, m, d] = from.split("-");
  const next = today && y > today.slice(0, 4) ? "来年 " : "";
  return `${period}の数です。前の ${days} 日との比べは ${next}${Number(m)} 月 ${Number(d)} 日から出ます`;
}

// 数え始めた日（取り込んだいちばん古い日。取り込んだことがなければ null）と、すべてのストアから届いているいちばん新しい日（なければ null）
export type StoreSpan = { since: string | null; until: string | null };

// 届いている日で終わる期間の値（直近 days 日と、その前の days 日）。sum(end) はその日で終わる期間の [いま, 前]。
// 取り込んだことがなければ undefined（「つなぐと出ます」）、どこからも届いていなければ notArrived
export function storeWeekValue(span: StoreSpan, today: string, days: number, sum: (end: string) => { now: number; prev: number } | null): WeekValue | undefined {
  if (!span.since) return undefined;
  if (!span.until) return { thisWeek: 0, lastWeek: 0, notArrived: true };
  const end = storeEnd(today, span.until);
  const v = sum(end) ?? { now: 0, prev: 0 };
  const known = storePrevKnown(span.since, end, days);
  return { thisWeek: v.now, lastWeek: known ? v.prev : v.now, ...(known ? {} : { noPrev: true as const, comparableFrom: addDays(span.since, days * 2 - 1) }), ...(end < today ? { until: end } : {}) };
}
