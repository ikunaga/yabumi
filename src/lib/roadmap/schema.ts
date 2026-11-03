import { z } from "zod";
import { KPI_KEYS, KPIS, kpiAllowed, kpiKeysFor, type KpiKey } from "@/lib/metrics/kpis";
import { isProductType, type ProductType } from "@/lib/projects/product-types";
import { SNS, SNS_KEYS, type SnsKey } from "@/lib/sns";
import { addDays, isYmd, weekdayOf } from "@/lib/time";
import { TODO_KINDS, type TodoKind } from "./todo-kind";

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
    // 種類（4.42）。null なら保存するときに推す
    kind: z.enum(TODO_KINDS).nullable().default(null),
  })
  .refine((v) => (v.kpi === null) === (v.target === null), { message: "数字と目標の値は両方決めるか、両方空にしてください", path: ["target"] })
  .refine(snsOnlyPosts, { message: SNS_ONLY_POSTS, path: ["sns"] });
// kind は任意（手で足すときは画面で選ばない。保存するときに推す）
export type ItemInput = Omit<z.infer<typeof itemSchema>, "kind"> & { kind?: TodoKind | null };

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
        // 種類（押したときの行き先。4.42）。出さなかった・形が違うときは、保存するときに推す
        kind: z.enum(TODO_KINDS).nullable().catch(null).default(null),
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

// やることに数える投稿（DB の roadmap_item_progress）。published・scheduled は、その週の投稿と結びついた投稿を重ならないように数えたもの。
// linked* はそのうち、やることから作った（結びついた）投稿のもの
export type ItemPostCounts = { published: number; scheduled: number; linkedPublished: number; linkedScheduled: number };

// やることの進み具合（その週の数字）。自動で数えられない数字は null。
// 投稿した回数は、DB で数えたもの（posts）があればそれを使う（結びついた投稿が週のあとに送られても数える）
export function itemProgress(
  item: { weekStart: string; kpi: KpiKey | null; target: number | null; sns?: SnsKey | null; posts?: ItemPostCounts | null },
  daily: DailyTotal[],
): { actual: number; target: number } | null {
  if (!isAutoKpi(item.kpi) || item.target === null) return null;
  if (item.kpi === "posts" && item.posts) return { actual: item.posts.published, target: item.target };
  return { actual: sumBetween(daily, item.kpi, item.weekStart, addDays(item.weekStart, 6), item.sns ?? null), target: item.target };
}

// やることの、読むときの状態。自動で数える数字（AUTO_KPIS）が付いたまだのやることは、その週の数字が目標に届いたら「達成」（achieved）。
// DB の status は書き換えない（数字があとで減ったら「まだ」に戻る）。済み（done）・やらない（skipped）は手で決めたまま。
// 達成は「済み」と同じに数える（今週の件数・概要の帯の先頭・プロジェクトの一覧・カレンダー・予定日を過ぎたやること。オーナーの指摘 2026-11-03）。
// DB で数えるプロジェクトの一覧（project_step_flags）も同じ決め方
export type ItemState = "todo" | "done" | "skipped" | "achieved";
export function effectiveStatus(item: { status: "todo" | "done" | "skipped" }, progress: { actual: number; target: number } | null): ItemState {
  if (item.status === "todo" && progress && progress.actual >= progress.target) return "achieved";
  return item.status;
}

// 済んだか（手で済みにした・数字で達成した）
export function isFinished(state: ItemState): boolean {
  return state === "done" || state === "achieved";
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

// 自動で数えられない数字の、「何をすると出るか」の説明（4.22 の KPIS）。
// アプリでないのにストアの数字を選んでいる（種類をアプリから変えた）ときは、つなぐ先がないので選び直してもらう（決定 D34）
export function notCountedYet(kpi: KpiKey, productType?: string | null): string {
  if (!kpiAllowed(kpi, productType)) return "宣伝するものが「アプリ」のときだけ数えます。「目標と数字を手で決める・直す」で、ほかの数字を選び直してください";
  return KPIS[kpi].howToGet ?? "数字の取り込みを作ったら出ます";
}

// ロードマップの目標（KGI）の欄の例。宣伝するものの種類ごと（決定 D34）
const KGI_EXAMPLES: Record<ProductType, string> = {
  app: "3 か月で 100 ダウンロード",
  web_service: "3 か月で登録 50 人",
  shop: "3 か月で SNS を見て来たお客さん 30 人",
  online_shop: "3 か月で 20 件売れる",
  service: "3 か月で体験の申し込み 15 件",
  creator: "3 か月でフォロワー 300 人",
  other: "3 か月で行き先へのクリック 300 回",
};

export function kgiExample(productType: string | null | undefined): string {
  return KGI_EXAMPLES[isProductType(productType) ? productType : "app"];
}

// 目標と数字の欄の選択肢にする数字。その種類で出せるものに、いま選んでいるもの（種類をアプリから変えた人のストアの数字）を足す。
// 選んでいるものを黙って別の数字に変えないため（保存し直すまでは残る）
export function goalKpiKeys(productType: string | null | undefined, current: readonly KpiKey[] = []): KpiKey[] {
  const allowed = kpiKeysFor(productType);
  return KPI_KEYS.filter((k) => allowed.includes(k) || current.includes(k));
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
