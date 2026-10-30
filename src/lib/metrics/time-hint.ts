import type { TimeBand, TimeTrends } from "./time-bands";

// 投稿をつくるの日時の欄に出す時間帯: よく見られる帯があればそれ、なければよくクリックされる帯。どちらも比べられなければ出さない
export function timeHintOf(trends: TimeTrends): { band: TimeBand; kind: "views" | "clicks" } | null {
  if (trends.views.ready) return { band: trends.views.best, kind: "views" };
  if (trends.clicks.ready) return { band: trends.clicks.best, kind: "clicks" };
  return null;
}
