// 時間帯ごとの傾向（数字の段 4、docs/roadmap.md の「数字の段」の C）。DB の time_band_of と同じ分け方（日本時間）。
// 比べてよいのは、閲覧は 5 本以上・クリックは 5 回以上ある帯だけで、そうした帯が 2 つ以上あるとき（少ない数で比べない）

export const TIME_BANDS = ["morning", "noon", "evening", "night"] as const;
export type TimeBand = (typeof TIME_BANDS)[number];

// hours は画面に出す範囲、at は「この時間帯に入れる」で日時に入れる時刻
export const BAND_INFO: Record<TimeBand, { label: string; hours: string; at: string }> = {
  morning: { label: "朝", hours: "5〜11 時", at: "08:00" },
  noon: { label: "昼", hours: "11〜16 時", at: "12:00" },
  evening: { label: "夕", hours: "16〜20 時", at: "18:00" },
  night: { label: "夜", hours: "20〜5 時", at: "21:00" },
};

export const MIN_POSTS_PER_BAND = 5;
export const MIN_CLICKS_PER_BAND = 5;

// 日本時間の時（0〜23）から時間帯
export function bandOfHour(hour: number): TimeBand {
  if (hour >= 5 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 15) return "noon";
  if (hour >= 16 && hour <= 19) return "evening";
  return "night";
}

export type TrendRow = { band: string; posts: number; avgViews: number | null; clicks: number };

// 1 つの数え方（閲覧・クリック）の結果。ready でなければ、あと何本（回）で比べられるか
export type TrendSide =
  | { ready: true; best: TimeBand; bands: { band: TimeBand; value: number; count: number }[] }
  | { ready: false; need: number };

export type TimeTrends = { views: TrendSide; clicks: TrendSide };

function side(values: { band: TimeBand; value: number; count: number }[], min: number): TrendSide {
  const ok = values.filter((v) => v.count >= min);
  if (ok.length >= 2) {
    const sorted = [...ok].sort((a, b) => b.value - a.value);
    return { ready: true, best: sorted[0].band, bands: ok };
  }
  // 数の多い 2 つの帯が、それぞれしきい値に届くまでの数
  const top = [...values].sort((a, b) => b.count - a.count).slice(0, 2);
  return { ready: false, need: top.reduce((n, v) => n + Math.max(0, min - v.count), 0) };
}

export function summarizeTrends(rows: TrendRow[]): TimeTrends {
  const byBand = new Map(rows.filter((r) => (TIME_BANDS as readonly string[]).includes(r.band)).map((r) => [r.band as TimeBand, r]));
  const all = TIME_BANDS.map((band) => byBand.get(band) ?? { band, posts: 0, avgViews: null, clicks: 0 });
  return {
    views: side(
      all.map((r) => ({ band: r.band as TimeBand, value: r.avgViews ?? 0, count: r.avgViews === null ? 0 : r.posts })),
      MIN_POSTS_PER_BAND,
    ),
    clicks: side(
      all.map((r) => ({ band: r.band as TimeBand, value: r.clicks, count: r.clicks })),
      MIN_CLICKS_PER_BAND,
    ),
  };
}

// 「この時間帯に入れる」で入れる日時（"YYYY-MM-DDTHH:MM"）。日付が決まっていればその日、なければ today（その時刻を過ぎていれば翌日）
export function plannedAtFor(band: TimeBand, current: string, today: string, nowHm: string): string {
  const at = BAND_INFO[band].at;
  if (/^\d{4}-\d{2}-\d{2}/.test(current)) return `${current.slice(0, 10)}T${at}`;
  if (nowHm < at) return `${today}T${at}`;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T${at}`;
}
