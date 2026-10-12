import { z } from "zod";
import { KPI_KEYS, KPIS, type KpiKey } from "@/lib/metrics/kpis";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { addDays, isYmd, weekdayOf } from "@/lib/time";

// ロードマップ（F10、docs/architecture.md の 4.23）の形と、進み具合の計算。画面とサーバーの両方から読む

// SNS ごとの「投稿した回数」を並べられるように 6 つまで（DB の roadmaps_kpi_targets_check と同じ）
export const MAX_KPI_TARGETS = 6;
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
// 数える SNS（null はすべての SNS）。SNS ごとに数えられるのは「投稿した回数」だけ（2026-10-12 の不具合: SNS を持たず、全 SNS の合計で「届きました」と出ていた）
const snsField = z.enum(SNS_KEYS as [SnsKey, ...SnsKey[]]).nullable().default(null);
const SNS_ONLY_POSTS = "SNS を選べるのは「投稿した回数」だけです";
const snsOnlyPosts = (v: { kpi: KpiKey | null; sns: SnsKey | null }) => v.sns === null || v.kpi === "posts";
const monday = ymd.refine((v) => weekdayOf(v) === 1, "週の始まり（月曜）の日付にしてください");

export const kgiSchema = z
  .object({
    statement: z.string().trim().min(1, "目標をひとことで書いてください").max(120, "目標は 120 字以内にしてください"),
    kpi: z.enum(KPI_KEYS),
    target: z.number().positive("目標の値は 0 より大きくしてください").max(1_000_000),
    deadline: ymd,
    sns: snsField,
  })
  .refine(snsOnlyPosts, { message: SNS_ONLY_POSTS, path: ["sns"] });
export type Kgi = z.infer<typeof kgiSchema>;

export const kpiTargetsSchema = z
  .array(z.object({ kpi: z.enum(KPI_KEYS), per_week: z.number().positive().max(1_000_000), sns: snsField }).refine(snsOnlyPosts, { message: SNS_ONLY_POSTS, path: ["sns"] }))
  .max(MAX_KPI_TARGETS, `追いかける数字は ${MAX_KPI_TARGETS} つまでにしてください`)
  .refine((list) => new Set(list.map((t) => `${t.kpi}:${t.sns ?? ""}`)).size === list.length, "同じ数字（同じ SNS）が 2 つあります");
export type KpiTarget = z.infer<typeof kpiTargetsSchema>[number];

export const itemSchema = z
  .object({
    title: z.string().trim().min(1, "やることを書いてください").max(MAX_ITEM_TITLE, `やることは ${MAX_ITEM_TITLE} 字以内にしてください`),
    detail: z.string().trim().max(MAX_ITEM_DETAIL).default(""),
    week_start: monday,
    kpi: z.enum(KPI_KEYS).nullable().default(null),
    target: z.number().positive().max(1_000_000).nullable().default(null),
    sns: snsField,
  })
  .refine((v) => (v.kpi === null) === (v.target === null), { message: "数字と目標の値は両方決めるか、両方空にしてください", path: ["target"] })
  .refine(snsOnlyPosts, { message: SNS_ONLY_POSTS, path: ["sns"] });
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
        // 「Instagram に 1 本」のような SNS を決めた投稿は、その SNS（posts のときだけ）
        sns: snsField,
      }).refine(snsOnlyPosts, { message: SNS_ONLY_POSTS, path: ["sns"] }),
    )
    .min(1)
    .max(MAX_ITEMS_PER_PROPOSAL),
});

// ===== 進み具合 =====

// posts はすべての SNS の合計、postsBySns は SNS ごとの送信済み（どちらも DB の counted_post_targets から）
export type DailyTotal = { day: string; posts: number; link_clicks: number; postsBySns?: Partial<Record<SnsKey, number>> };

function sumBetween(daily: DailyTotal[], kpi: "posts" | "link_clicks", from: string, toInclusive: string, sns: SnsKey | null = null): number {
  return daily
    .filter((d) => d.day >= from && d.day <= toInclusive)
    .reduce((n, d) => n + (kpi === "posts" && sns ? (d.postsBySns?.[sns] ?? 0) : d[kpi]), 0);
}

// 数字の名前。投稿した回数は数える SNS を添える（null は「すべての SNS」）
export function kpiLabel(kpi: KpiKey, sns: SnsKey | null | undefined): string {
  return kpi === "posts" ? `${KPIS.posts.label}（${sns ? SNS[sns].label : "すべての SNS"}）` : KPIS[kpi].label;
}

// やることの進み具合（その週の数字）。自動で数えられない数字は null
export function itemProgress(
  item: { weekStart: string; kpi: KpiKey | null; target: number | null; sns?: SnsKey | null },
  daily: DailyTotal[],
): { actual: number; target: number } | null {
  if (!isAutoKpi(item.kpi) || item.target === null) return null;
  return { actual: sumBetween(daily, item.kpi, item.weekStart, addDays(item.weekStart, 6), item.sns ?? null), target: item.target };
}

// 週の数字（KPI の週の目標と比べる）
export function weekValue(kpi: KpiKey, weekStart: string, daily: DailyTotal[], sns: SnsKey | null = null): number | null {
  return isAutoKpi(kpi) ? sumBetween(daily, kpi, weekStart, addDays(weekStart, 6), sns) : null;
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
  const actual = sumBetween(daily, kgi.kpi, startedOn, today, kgi.sns);
  const daysLeft = Math.max(0, Math.round((new Date(`${kgi.deadline}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000));
  const recentFrom = addDays(today, -13) > startedOn ? addDays(today, -13) : startedOn;
  const recentDays = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${recentFrom}T00:00:00Z`).getTime()) / 86_400_000) + 1;
  const recent = sumBetween(daily, kgi.kpi, recentFrom, today, kgi.sns);
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

// 画面の選択肢: 数字と SNS を 1 つの値にする（"posts" はすべての SNS、"posts:instagram" は Instagram の投稿した回数）
export function kpiChoiceValue(kpi: KpiKey, sns: SnsKey | null | undefined): string {
  return kpi === "posts" && sns ? `posts:${sns}` : kpi;
}

export function parseKpiChoice(v: unknown): { kpi: string; sns: string | null } {
  const [kpi = "", sns = null] = String(v ?? "").split(":");
  return { kpi, sns: sns || null };
}

// 選択肢の並び: 投稿した回数（すべて → SNS ごと）のあとに、ほかの数字
export type KpiChoice = { value: string; label: string; kpi: KpiKey };
export function kpiChoices(kpis: readonly KpiKey[] = KPI_KEYS): KpiChoice[] {
  return kpis.flatMap((kpi): KpiChoice[] =>
    kpi === "posts"
      ? [{ value: "posts", label: kpiLabel("posts", null), kpi }, ...SNS_KEYS.map((s) => ({ value: kpiChoiceValue("posts", s), label: kpiLabel("posts", s), kpi }))]
      : [{ value: kpi, label: kpiLabel(kpi, null), kpi }],
  );
}
