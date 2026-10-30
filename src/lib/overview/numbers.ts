// 概要の数字（見本 A。docs/architecture.md の 4.31）。読み込みは load.ts、ここは並べ方を決めるだけ（テストできるように DB を触らない）
import { KPIS, type KpiKey } from "@/lib/metrics/kpis";
import type { KpiValues } from "@/lib/metrics/queries";
import { addDays, formatTime, toYmd } from "@/lib/time";

// 概要は直近 30 日と、その前の 30 日を比べる（固定。切り替えは分析の画面で）
export const OVERVIEW_DAYS = 30;
// 日ごとの棒グラフの日数（PC は 14 日、スマホは 7 日）
export const CHART_DAYS = 14;
export const CHART_DAYS_MOBILE = 7;

export type Daily = { day: string; value: number };

export type OverviewCard = {
  key: "downloads" | "link_clicks" | "posts" | "kpi" | "play_dl" | "scheduled" | "drafts";
  // 追いかける数字（d）のときの種類。ラベルと用語の解説に使う
  kpi?: KpiKey;
  label: string;
  value: number;
  // 通貨（売上）のときだけ
  currency?: string;
  unit?: string;
  // 前と比べた増減（%）。前が 0 のときと、比べない数（予約中・下書き）は null
  deltaPct: number | null;
  // 添え書き（「前の 30 日比」「うち予約 3 件」「直近 7 日・先週比」）
  note?: string;
};

export type OverviewInput = {
  today: string;
  // ストアの日ごとのダウンロード（つないでいなければ null）
  downloads: Daily[] | null;
  // 短縮リンクの日ごとのクリック（リンクを 1 つも作っていなければ null）
  clicks: Daily[] | null;
  // 送った投稿（SNS ごとに 1 と数える）の日ごと
  published: Daily[];
  scheduledCount: number;
  draftCount: number;
  // アカウント設計で選んだ追いかける数字（選んでいなければおすすめ）と、その週の値
  kpis: KpiKey[];
  kpiValues: KpiValues;
  // Google Play が数えた、矢書の短縮リンクからの DL（直近 30 日。Google Play をつないでいなければ null。数字の段 3）
  playSnsDl?: number | null;
  // 数え始めた日（日本時間の YYYY-MM-DD）。前の 30 日がこれより前にかかるなら比べない（数える前の日を 0 として比べない。分析と同じ）。
  // ダウンロード・ストアのページの閲覧はストアを取り込み始めた日、クリックはいちばん古い短縮リンクを作った日、投稿はプロジェクトを作った日
  since?: { downloads?: string | null; clicks?: string | null; posts?: string | null };
};

// 前の 30 日の始まりより前から数えていれば、比べられる
export function prevKnown(since: string | null | undefined, today: string, days = OVERVIEW_DAYS): boolean {
  if (since === undefined) return true;
  return since !== null && since <= addDays(today, -(days * 2 - 1));
}

// [from, to] の合計（日付は YYYY-MM-DD）
export function sumDays(rows: Daily[], from: string, to: string): number {
  return rows.reduce((n, r) => (r.day >= from && r.day <= to ? n + r.value : n), 0);
}

// 増減（%）。前が 0 なら比べられないので null
export function pctChange(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

// 直近 days 日（今日まで）と、その前の days 日
export function compareDays(rows: Daily[], today: string, days = OVERVIEW_DAYS): { now: number; before: number } {
  return {
    now: sumDays(rows, addDays(today, -(days - 1)), today),
    before: sumDays(rows, addDays(today, -(days * 2 - 1)), addDays(today, -days)),
  };
}

// 直近 days 日を 1 日ずつ（ない日は 0）
export function dailySeries(rows: Daily[], today: string, days: number): Daily[] {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.value);
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - days + 1);
    return { day, value: byDay.get(day) ?? 0 };
  });
}

// 前の 30 日と比べる数字のカード
function compared(key: "downloads" | "link_clicks" | "posts", label: string, rows: Daily[], today: string, since?: string | null): OverviewCard {
  const { now, before } = compareDays(rows, today);
  // 単位は予約中・下書き（件）とそろえる。ダウンロードは数だけ（「DL」と書き分けない）
  const unit = key === "posts" ? "件" : key === "link_clicks" ? "回" : undefined;
  if (!prevKnown(since, today)) return { key, label, value: now, unit, deltaPct: null, note: "前の記録はまだありません" };
  const deltaPct = pctChange(now, before);
  return { key, label, value: now, unit, deltaPct, note: deltaPct === null ? (before === 0 && now > 0 ? "前の 30 日は 0" : undefined) : "前の 30 日比" };
}

// 4 枚のカードを、出せるものから順に選ぶ（PM と決めた a〜e。出せない数字は出さず、「準備中」でも埋めない）
// a. ダウンロード（ストアをつないでいれば） b. ストアへのクリック（短縮リンクがあれば） c. 投稿数（いつも）
// d. 追いかける数字のうち a〜c 以外で値があるもの d'. Google Play が数えた SNS からの DL（つないでいれば）e. 予約中 → 下書き（いつも出せる本当の数。比べない）
export function pickOverviewCards(input: OverviewInput, max = 4): OverviewCard[] {
  const { today } = input;
  const cards: OverviewCard[] = [];
  if (input.downloads) cards.push(compared("downloads", "ダウンロード", input.downloads, today, input.since?.downloads));
  if (input.clicks) cards.push(compared("link_clicks", "ストアへのクリック", input.clicks, today, input.since?.clicks));
  const postsAt = cards.length;
  cards.push(compared("posts", "投稿数", input.published, today, input.since?.posts));

  for (const k of input.kpis) {
    if (cards.length >= max) break;
    if (k === "downloads" || k === "link_clicks" || k === "posts") continue;
    const raw = input.kpiValues[k];
    if (!raw) continue;
    // ストアのページの閲覧は、ストアを取り込み始めて 7 日たつまで比べない（直近 7 日と先週の比べ）
    const v = k === "store_page_views" && !prevKnown(input.since?.downloads, today, 7) ? { ...raw, noPrev: true as const } : raw;
    cards.push({
      key: "kpi",
      kpi: k,
      label: KPIS[k].label,
      value: v.thisWeek,
      currency: v.unit,
      // 売上は 28 日の合計、ほかは直近 7 日（分析の画面と同じ値）
      deltaPct: v.noPrev ? null : pctChange(v.thisWeek, v.lastWeek),
      note: v.noPrev ? "直近 7 日・前の記録はまだありません" : v.unit ? "直近 28 日・1 週間前比" : "直近 7 日・先週比",
    });
  }

  // Google Play が数えた SNS からの DL（App Store の分は入らないので、名前と添え書きで必ずそう書く。前と比べない）
  if (input.playSnsDl != null && cards.length < max) {
    cards.push({ key: "play_dl", label: "Google Play が数えた SNS からの DL", value: input.playSnsDl, deltaPct: null, note: "直近 30 日・App Store は入りません" });
  }

  const fillers: OverviewCard[] = [
    { key: "scheduled", label: "予約中", value: input.scheduledCount, unit: "件", deltaPct: null },
    { key: "drafts", label: "下書き", value: input.draftCount, unit: "件", deltaPct: null },
  ];
  for (const f of fillers) if (cards.length < max) cards.push(f);

  // 予約中のカードがなければ、投稿数に「うち予約」を添える（見本 A の「うち予約 84 件」）
  if (!cards.some((c) => c.key === "scheduled")) cards[postsAt] = { ...cards[postsAt], note: `うち予約 ${input.scheduledCount} 件` };
  return cards.slice(0, max);
}

// 次の予約の時刻（「18:00」「明日 12:00」「11/1 09:00」）。今日は時刻だけ
export function slotLabel(iso: string, now: Date): string {
  const today = toYmd(now);
  const day = toYmd(new Date(iso));
  const time = formatTime(iso);
  if (day === today) return time;
  if (day === addDays(today, 1)) return `明日 ${time}`;
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)} ${time}`;
}

// グラフの日付の目盛り（「10/17」）
export function shortDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}
