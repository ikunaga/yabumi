// 自動の投稿の AI に渡す「送る日」と季節（docs/design/auto-sample-image.md の 12.。2026-11-21 の本物の確かめで、
// 「季節の話から入る」が効かなかった〈AI が送る日を知らない〉ための直し）。日本の暦（日本時間）で、北半球の前提
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 月ごとの季節の呼び方（1 月 = 真冬 … 12 月 = 初冬）。旬・行事の細かい日付は AI に任せず、月で決める
const SEASON_BY_MONTH = ["真冬", "晩冬", "早春", "春", "晩春", "初夏（梅雨のころ）", "夏", "晩夏", "初秋", "秋", "晩秋", "初冬"];

export function jstParts(d: Date): { month: number; day: number; weekday: string } {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  return { month: j.getUTCMonth() + 1, day: j.getUTCDate(), weekday: WEEKDAYS[j.getUTCDay()] };
}

export function seasonOf(d: Date): string {
  return SEASON_BY_MONTH[jstParts(d).month - 1];
}

// 「11 月 24 日（月）。季節は晩秋」。年は書かない（投稿の文に年を書かせないため）
export function dueDayText(d: Date): string {
  const { month, day, weekday } = jstParts(d);
  return `${month} 月 ${day} 日（${weekday}）。季節は${seasonOf(d)}（日本）`;
}
