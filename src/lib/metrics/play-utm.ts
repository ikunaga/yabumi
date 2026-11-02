// Google Play が数えた、yabumi の短縮リンク（UTM）ごとの DL（数字の段 3。docs/roadmap.md の「数字の段」の D-2・F）。
// 取り込みは src/lib/stores/google.ts の summarizePlayUtm。ここは期間で足すだけ（DB を触らない）
import { isSnsKey, type SnsKey } from "@/lib/sns";

export type PlayUtmRow = { day: string; by_source: Record<string, number>; by_campaign: Record<string, number>; other: number };

export type PlayUtmTotals = {
  // SNS ごと（SNS を決めていないリンクは null）
  bySns: { sns: SnsKey | null; value: number }[];
  byCampaign: Record<string, number>;
  total: number;
  // Google が「Other」にまとめた分（yabumi のリンク以外も入る）
  other: number;
};

export function sumPlayUtm(rows: PlayUtmRow[], from: string, to: string): PlayUtmTotals {
  const bySource = new Map<string, number>();
  const byCampaign: Record<string, number> = {};
  let other = 0;
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    for (const [s, n] of Object.entries(r.by_source)) bySource.set(s, (bySource.get(s) ?? 0) + n);
    for (const [c, n] of Object.entries(r.by_campaign)) byCampaign[c] = (byCampaign[c] ?? 0) + n;
    other += r.other;
  }
  // SNS でない名前（SNS を決めていないリンクの "link" など）は「SNS なし」1 つにまとめる
  const merged = new Map<SnsKey | null, number>();
  for (const [s, value] of bySource) {
    const key = isSnsKey(s) ? s : null;
    merged.set(key, (merged.get(key) ?? 0) + value);
  }
  const bySns = [...merged.entries()]
    .map(([sns, value]) => ({ sns, value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  return { bySns, byCampaign, total: bySns.reduce((n, r) => n + r.value, 0), other };
}

// 投稿のリンクのコードから、その投稿の DL を足す
export function campaignTotal(byCampaign: Record<string, number>, codes: string[]): number {
  return codes.reduce((n, c) => n + (byCampaign[c] ?? 0), 0);
}
