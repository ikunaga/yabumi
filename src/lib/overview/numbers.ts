// 概要の数字（見本 A。docs/architecture.md の 4.31）。読み込みは load.ts、ここは並べ方を決めるだけ（テストできるように DB を触らない）
import { clickLabel, KPIS, type KpiKey } from "@/lib/metrics/kpis";
import type { KpiValues, WeekValue } from "@/lib/metrics/queries";
import { compareLabel, NOT_ARRIVED, periodLabel } from "@/lib/metrics/store-period";
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
  // 遅れて届く数字がどのストアからもまだ届いていない（数は出さず、添え書きに「まだ届いていません」）
  notArrived?: true;
  // 添え書き（「前の 30 日比」「うち予約 3 件」「直近 7 日・先週比」）
  note?: string;
};

export type OverviewInput = {
  today: string;
  // ストアのダウンロードの、届いている日で終わる 30 日とその前の 30 日（つないでいなければ null。queries.ts の loadStoreTotals）
  downloads: WeekValue | null;
  // 短縮リンクの日ごとのクリック（リンクを 1 つも作っていなければ null）
  clicks: Daily[] | null;
  // 送った投稿（SNS ごとに 1 と数える）の日ごと
  published: Daily[];
  scheduledCount: number;
  draftCount: number;
  // アカウント設計で選んだ追いかける数字（選んでいなければおすすめ）と、その週の値
  kpis: KpiKey[];
  kpiValues: KpiValues;
  // Google Play が数えた、yabumi の短縮リンクからの DL（直近 30 日。Google Play をつないでいなければ null。数字の段 3）
  // until: 届いているいちばん新しい日で終わる 30 日のとき。notArrived: まだ 1 日も届いていない
  playSnsDl?: { value: number; until?: string; notArrived?: true } | null;
  // 数え始めた日（日本時間の YYYY-MM-DD）。前の 30 日がこれより前にかかるなら比べない（数える前の日を 0 として比べない。分析と同じ）。
  // クリックはいちばん古い短縮リンクを作った日、投稿はプロジェクトを作った日（ダウンロード・ストアのページの閲覧は、読み込みで比べるかを決めてある）
  since?: { clicks?: string | null; posts?: string | null };
  // 宣伝するものの種類（決定 D34）。クリックのカードの名前を、アプリなら「ストアへのクリック」、ほかは「行き先へのクリック」にする
  productType?: string | null;
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

// 遅れて届く数字（ダウンロード・ストアのページの閲覧）のカード。届いている日で終わる期間なら「10/30 までの 30 日・その前の 30 日比」と終わりの日を書く。
// 概要のほかのカードと同じ 30 日で今日まで届いているときは、期間を書かない（「前の 30 日比」）
function delayedCard(base: Pick<OverviewCard, "key" | "kpi" | "label">, v: WeekValue, days: number): OverviewCard {
  if (v.notArrived) return { ...base, value: 0, notArrived: true, deltaPct: null, note: NOT_ARRIVED };
  const prefix = v.until || days !== OVERVIEW_DAYS ? `${periodLabel(days, v.until)}・` : "";
  if (v.noPrev) return { ...base, value: v.thisWeek, deltaPct: null, note: `${prefix}前の記録はまだありません` };
  const deltaPct = pctChange(v.thisWeek, v.lastWeek);
  const zero = v.lastWeek === 0 && v.thisWeek > 0 ? `${v.until ? "その" : ""}前の ${days} 日は 0` : null;
  const note = deltaPct !== null ? `${prefix}${compareLabel(days, v.until)}` : zero ? `${prefix}${zero}` : prefix ? periodLabel(days, v.until) : undefined;
  return { ...base, value: v.thisWeek, deltaPct, note };
}

// 4 枚のカードを、出せるものから順に選ぶ（PM と決めた a〜e。出せない数字は出さず、「準備中」でも埋めない）
// a. ダウンロード（ストアをつないでいれば） b. 行き先へのクリック（アプリならストア。短縮リンクがあれば） c. 投稿数（いつも）
// d. 追いかける数字のうち a〜c 以外で値があるもの d'. Google Play が数えた SNS からの DL（つないでいれば）e. 予約中 → 下書き（いつも出せる本当の数。比べない）
export function pickOverviewCards(input: OverviewInput, max = 4): OverviewCard[] {
  const { today } = input;
  const cards: OverviewCard[] = [];
  if (input.downloads) cards.push(delayedCard({ key: "downloads", label: "ダウンロード" }, input.downloads, OVERVIEW_DAYS));
  if (input.clicks) cards.push(compared("link_clicks", clickLabel(input.productType), input.clicks, today, input.since?.clicks));
  const postsAt = cards.length;
  cards.push(compared("posts", "投稿数", input.published, today, input.since?.posts));

  for (const k of input.kpis) {
    if (cards.length >= max) break;
    if (k === "downloads" || k === "link_clicks" || k === "posts") continue;
    const raw = input.kpiValues[k];
    if (!raw) continue;
    // ストアのページの閲覧は遅れて届く（届いている日で終わる 7 日。比べるかは読み込みで決めてある）
    if (k === "store_page_views") {
      cards.push(delayedCard({ key: "kpi", kpi: k, label: KPIS[k].label }, raw, 7));
      continue;
    }
    const v = raw;
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
    const p = input.playSnsDl;
    cards.push(
      p.notArrived
        ? { key: "play_dl", label: "Google Play が数えた SNS からの DL", value: 0, notArrived: true, deltaPct: null, note: NOT_ARRIVED }
        : { key: "play_dl", label: "Google Play が数えた SNS からの DL", value: p.value, deltaPct: null, note: `${periodLabel(OVERVIEW_DAYS, p.until)}・App Store は入りません` },
    );
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

// 日ごとの棒グラフの縦の目盛り。上はいちばん大きい日の値、間はその半分（整数にならない 1 のときは出さない）、下は 0。値がすべて 0 なら上を 1 に
export function chartTicks(rows: Daily[]): { top: number; ticks: number[] } {
  const top = Math.max(1, ...rows.map((r) => r.value));
  const half = Math.floor(top / 2);
  return { top, ticks: half > 0 ? [top, half, 0] : [top, 0] };
}

// 強調して数を必ず出す日（いちばん大きい日のうち最後の日。0 しかなければなし）
export function peakIndex(rows: Daily[]): number | null {
  let at: number | null = null;
  rows.forEach((r, i) => {
    if (r.value > 0 && (at === null || r.value >= rows[at].value)) at = i;
  });
  return at;
}

// 遅れて届く数字（ストアのダウンロード・ページの閲覧）の、すべてのストアから届いているいちばん新しい日。
// ストアごとの届いたいちばん新しい日のうち早いほう（片方しか届いていない日は、まだ合計が決まらない）。どこからも届いていなければ null。
// connected: いまつないでいる取り込み元。渡せば、その中だけで決める（外したストアの最後の日に引っ張られないように）。
// 数字の取り込み元をどれもつないでいなければ（すべて外したあと）、残っている数字のいちばん新しい日まで
export function arrivedUntil(rows: { day: string; source: string }[], sources: readonly string[], connected?: readonly string[] | null): string | null {
  const live = connected ? sources.filter((s) => connected.includes(s)) : [];
  const ends = (live.length ? live : sources).flatMap((s) => {
    const days = rows.filter((r) => r.source === s).map((r) => r.day).sort();
    return days.length ? [days[days.length - 1]] : [];
  });
  return ends.sort()[0] ?? null;
}

// 見出しの右に足す、いちばん新しい日の数。いつも届く数字は「今日 N」、遅れて届く数字は届いている日まで「最新 11/1: N」
export function latestAside(rows: Daily[], arrived?: string | null): string {
  const last = rows.at(-1);
  if (!last) return "";
  if (arrived === undefined) return `今日 ${last.value.toLocaleString("ja-JP")}`;
  if (arrived === null) return "まだ届いていません";
  if (arrived >= last.day) return `最新 ${shortDay(last.day)}: ${last.value.toLocaleString("ja-JP")}`;
  const r = rows.find((x) => x.day === arrived);
  return r ? `最新 ${shortDay(r.day)}: ${r.value.toLocaleString("ja-JP")}` : `最新 ${shortDay(arrived)}`;
}

// 日ごとの棒の期間。遅れて届く数字（arrived を渡したとき）は、届いている日で終わる days 日にそろえる（大きな数字・カードの「10/30 までの 7 日」と同じ期間。
// 今日で終わる期間にすると、届いた棒の合計と数字が合わない）。まだ届いていない日は棒にせず note に書く（「11/3 までの 4 日はまだ届いていません」）。
// いつも届く数字（arrived が undefined）と、今日まで届いているときは今日で終わる。どこからも届いていなければ null
export function chartWindow(series: Daily[], today: string, days: number, arrived?: string | null): { rows: Daily[]; until?: string; note?: string } | null {
  if (arrived === null) return null;
  if (arrived === undefined || arrived >= today) return { rows: dailySeries(series, today, days) };
  let gap = 0;
  while (addDays(arrived, gap) < today) gap++;
  return { rows: dailySeries(series, arrived, days), until: arrived, note: `${shortDay(today)} までの ${gap} 日はまだ届いていません` };
}
