import { z } from "zod";
import { KPI_KEYS, KPIS, type KpiKey } from "@/lib/metrics/kpis";
import { addDays, isYmd, weekdayOf } from "@/lib/time";

// ロードマップ（F10、docs/architecture.md の 4.23）の形と、進み具合の計算。画面とサーバーの両方から読む

export const MAX_KPI_TARGETS = 3;
export const MAX_ITEMS_PER_PROPOSAL = 8;
export const MAX_ITEM_TITLE = 100;
export const MAX_ITEM_DETAIL = 1000;
// 1 つのプロジェクトに置けるやることの数（AI の案を何度も採用して増えすぎないように）
export const MAX_ITEMS_PER_PROJECT = 200;

// いま自動で数えられる数字（roadmap_daily_totals）。ほかは取り込みができたら（4.22）
export const AUTO_KPIS: readonly KpiKey[] = ["posts", "link_clicks"];

export function isAutoKpi(kpi: KpiKey | null | undefined): kpi is "posts" | "link_clicks" {
  return kpi === "posts" || kpi === "link_clicks";
}

// その日を含む週の月曜（日本時間）
export function weekStartOf(ymd: string): string {
  return addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
}

const ymd = z.string().refine(isYmd, "日付の形式が正しくありません");
const monday = ymd.refine((v) => weekdayOf(v) === 1, "週の始まり（月曜）の日付にしてください");

export const kgiSchema = z.object({
  statement: z.string().trim().min(1, "目標をひとことで書いてください").max(120, "目標は 120 字以内にしてください"),
  kpi: z.enum(KPI_KEYS),
  target: z.number().positive("目標の値は 0 より大きくしてください").max(1_000_000),
  deadline: ymd,
});
export type Kgi = z.infer<typeof kgiSchema>;

export const kpiTargetsSchema = z
  .array(z.object({ kpi: z.enum(KPI_KEYS), per_week: z.number().positive().max(1_000_000) }))
  .max(MAX_KPI_TARGETS, `追いかける数字は ${MAX_KPI_TARGETS} つまでにしてください`)
  .refine((list) => new Set(list.map((t) => t.kpi)).size === list.length, "同じ数字が 2 つあります");
export type KpiTarget = z.infer<typeof kpiTargetsSchema>[number];

export const itemSchema = z
  .object({
    title: z.string().trim().min(1, "やることを書いてください").max(MAX_ITEM_TITLE, `やることは ${MAX_ITEM_TITLE} 字以内にしてください`),
    detail: z.string().trim().max(MAX_ITEM_DETAIL).default(""),
    week_start: monday,
    kpi: z.enum(KPI_KEYS).nullable().default(null),
    target: z.number().positive().max(1_000_000).nullable().default(null),
  })
  .refine((v) => (v.kpi === null) === (v.target === null), { message: "数字と目標の値は両方決めるか、両方空にしてください", path: ["target"] });
export type ItemInput = z.infer<typeof itemSchema>;

// ===== AI の提案の中身（value_json）。サーバーで検証する =====

// goal: KGI と KPI の週の目標
export const goalProposalSchema = z.object({ kgi: kgiSchema, kpi_targets: kpiTargetsSchema });

// roadmap_items: 今週を 0 とした何週目かで受け取り、採用するときに日付にする（AI に日付の計算をさせない）
export const itemsProposalSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(MAX_ITEM_TITLE),
        detail: z.string().trim().max(MAX_ITEM_DETAIL).default(""),
        week: z.number().int().min(0).max(52),
        kpi: z.enum(KPI_KEYS).nullable().default(null),
        target: z.number().positive().max(1_000_000).nullable().default(null),
      }),
    )
    .min(1)
    .max(MAX_ITEMS_PER_PROPOSAL),
});

// ===== 進み具合 =====

export type DailyTotal = { day: string; posts: number; link_clicks: number };

function sumBetween(daily: DailyTotal[], kpi: "posts" | "link_clicks", from: string, toInclusive: string): number {
  return daily.filter((d) => d.day >= from && d.day <= toInclusive).reduce((n, d) => n + d[kpi], 0);
}

// やることの進み具合（その週の数字）。自動で数えられない数字は null
export function itemProgress(item: { weekStart: string; kpi: KpiKey | null; target: number | null }, daily: DailyTotal[]): { actual: number; target: number } | null {
  if (!isAutoKpi(item.kpi) || item.target === null) return null;
  return { actual: sumBetween(daily, item.kpi, item.weekStart, addDays(item.weekStart, 6)), target: item.target };
}

// 週の数字（KPI の週の目標と比べる）
export function weekValue(kpi: KpiKey, weekStart: string, daily: DailyTotal[]): number | null {
  return isAutoKpi(kpi) ? sumBetween(daily, kpi, weekStart, addDays(weekStart, 6)) : null;
}

export type KgiProgress = {
  actual: number;
  target: number;
  ratio: number;
  daysLeft: number;
  // このままの調子（直近 14 日の平均）で期限までに届きそうか。数字が少なすぎて判断できなければ null
  onTrack: boolean | null;
  projected: number | null;
};

// KGI の進み具合: 始めた日から今日までの合計 ÷ 目標の値（自動で数えられる数字のときだけ）
export function kgiProgress(kgi: Kgi, startedOn: string, today: string, daily: DailyTotal[]): KgiProgress | null {
  if (!isAutoKpi(kgi.kpi)) return null;
  const actual = sumBetween(daily, kgi.kpi, startedOn, today);
  const daysLeft = Math.max(0, Math.round((new Date(`${kgi.deadline}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000));
  const recentFrom = addDays(today, -13) > startedOn ? addDays(today, -13) : startedOn;
  const recentDays = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${recentFrom}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  const recent = sumBetween(daily, kgi.kpi, recentFrom, today);
  // 始めて 1 週もたっていなければ、調子は判断しない
  const projected = recentDays >= 7 ? Math.round(actual + (recent / recentDays) * daysLeft) : null;
  return {
    actual,
    target: kgi.target,
    ratio: Math.min(1, actual / kgi.target),
    daysLeft,
    projected,
    onTrack: projected === null ? null : projected >= kgi.target,
  };
}

// 自動で数えられない数字の、「何をすると出るか」の説明（4.22 の KPIS）
export function notCountedYet(kpi: KpiKey): string {
  return KPIS[kpi].howToGet ?? "数字の取り込みを作ったら出ます";
}

export function formatValue(kpi: KpiKey, value: number): string {
  return kpi === "revenue" ? `${Math.round(value).toLocaleString("ja-JP")} 円` : `${Math.round(value * 10) / 10}`;
}
