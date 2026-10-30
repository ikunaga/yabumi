// 投稿した日と DL（またはクリック）の関係（数字の段 1。docs/roadmap.md の「数字の段」の B、見本 C の「投稿日と DL の相関」）。
// 「投稿した日とその翌日」と「どちらでもない日」の 1 日あたりを比べる。相関であって原因ではない（4.22 の決まり）。
// 少ない日数で比べると偶然が大きいので、どちらも MIN_DAYS 日そろうまでは比べない
import type { Daily } from "@/lib/overview/numbers";
import { addDays } from "@/lib/time";

export const POST_EFFECT_DAYS = 60;
export const MIN_DAYS = 7;

export type PostEffect = {
  // 比べた日の範囲（確定した日だけ）
  from: string;
  to: string;
  // 投稿した日とその翌日 / どちらでもない日 の日数と、1 日あたり
  postedDays: number;
  quietDays: number;
  postedAvg: number;
  quietAvg: number;
  // どちらも MIN_DAYS 日以上そろったか
  ready: boolean;
};

// published: 日ごとの送った投稿の数。values: 日ごとの DL かクリック。[from, to] の日だけを数える（値のない日は 0）
export function postEffect(published: Daily[], values: Daily[], from: string, to: string): PostEffect {
  const posted = new Set(published.filter((p) => p.value > 0).map((p) => p.day));
  const byDay = new Map<string, number>();
  for (const v of values) byDay.set(v.day, (byDay.get(v.day) ?? 0) + v.value);
  let postedDays = 0;
  let quietDays = 0;
  let postedSum = 0;
  let quietSum = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = byDay.get(d) ?? 0;
    if (posted.has(d) || posted.has(addDays(d, -1))) {
      postedDays++;
      postedSum += v;
    } else {
      quietDays++;
      quietSum += v;
    }
  }
  return {
    from,
    to,
    postedDays,
    quietDays,
    postedAvg: postedDays ? postedSum / postedDays : 0,
    quietAvg: quietDays ? quietSum / quietDays : 0,
    ready: postedDays >= MIN_DAYS && quietDays >= MIN_DAYS,
  };
}

// 比べる日の終わり（確定した日まで）。クリックは昨日まで（今日は途中）。
// ダウンロードはストアごとに取り込んだいちばん新しい日のうち早いほう。Google Play はあとから 3〜7 日分が直るので、さらに 7 日前まで
export function confirmedUntil(today: string, kind: "downloads" | "link_clicks", lastStoreDay: Partial<Record<"app_store" | "google_play", string>>): string | null {
  const yesterday = addDays(today, -1);
  if (kind === "link_clicks") return yesterday;
  const ends = [yesterday];
  if (lastStoreDay.app_store) ends.push(lastStoreDay.app_store);
  if (lastStoreDay.google_play) ends.push(lastStoreDay.google_play, addDays(today, -7));
  if (!lastStoreDay.app_store && !lastStoreDay.google_play) return null;
  return ends.sort()[0];
}
