import "server-only";
import type { KpiKey } from "@/lib/metrics/kpis";
import { loadMetricsOverview, loadStoreTotals, type ClicksBySns, type MetricsOverview, type WeekValue } from "@/lib/metrics/queries";
import { countUnsentDrafts } from "@/lib/posts/drafts";
import { createClient } from "@/lib/supabase/server";
import { addDays, toYmd } from "@/lib/time";
import { sumPlayUtm, utmEnd } from "@/lib/metrics/play-utm";
import { loadDailyNumbers, type StoreSource } from "@/lib/metrics/daily";
import { isAppProject } from "@/lib/projects/product-types";
import { OVERVIEW_DAYS, pickOverviewCards, type Daily, type OverviewCard } from "./numbers";

export type OverviewNumbers = {
  today: string;
  cards: OverviewCard[];
  // 日ごとの棒グラフ（ダウンロード、なければストアへのクリック。どちらもなければ null）。
  // arrived: 遅れて届くダウンロードの、届いているいちばん新しい日（クリックはいつも届くので undefined）
  chart: { kind: "downloads" | "link_clicks"; rows: Daily[]; arrived?: string | null } | null;
  // スマホの大きな数字に出す、ダウンロードの届いている日で終わる 7 日とその前の 7 日（グラフがダウンロードのときだけ。クリックは rows から数える）
  hero7?: WeekValue;
  hasStore: boolean;
  hasLinks: boolean;
  // 直近 60 日に数字を取り込んだストア（見出しの札に出す）
  stores: StoreSource[];
  clicksBySns: ClicksBySns[];
  // いちばんクリックされた投稿（30 日。スマホの概要に出す）
  topPost: MetricsOverview["topPosts"][number] | null;
};

// 概要の数字（直近 30 日と、その前の 30 日）。どれも本人だけが読める表と関数から読む（RLS）
// projectSince: プロジェクトを作った日（日本時間の YYYY-MM-DD。SNS への投稿の前の 30 日がこれより前なら比べない）
export async function loadOverviewNumbers(projectId: string, kpis: KpiKey[], projectSince?: string, productType?: string): Promise<OverviewNumbers> {
  const supabase = await createClient();
  const today = toYmd(new Date());
  const [overview, store30, daily, links, scheduled, drafts] = await Promise.all([
    loadMetricsOverview(projectId, supabase),
    // ダウンロードのカードは、届いている日で終わる 30 日とその前の 30 日
    loadStoreTotals(supabase, projectId, today, OVERVIEW_DAYS),
    // 直近 30 日と前の 30 日
    loadDailyNumbers(supabase, projectId, today, OVERVIEW_DAYS * 2),
    supabase.from("short_links").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "scheduled").gte("planned_at", new Date().toISOString()),
    // 下書き: 予約していない投稿のうち、どこにも送っていないもの（今すぐ送った投稿は下書きの状態のまま送られる。src/lib/posts/drafts.ts）
    countUnsentDrafts(supabase, projectId),
  ]);
  if (links.error) throw links.error;
  if (scheduled.error) throw scheduled.error;

  // ダウンロードは、宣伝するものがアプリで、ストアから取り込んだことがあるときだけ（分析の画面と同じ判定）。
  // 種類をアプリから変えたプロジェクトは、取り込んだ記録を残したまま出さない（決定 D34。アプリに戻せばまた出る）
  const isApp = isAppProject({ product_type: productType });
  const hasStore = isApp && Boolean(overview.kpiValues.downloads);
  const hasLinks = (links.count ?? 0) > 0;
  const downloads: Daily[] | null = hasStore ? daily.downloads : null;
  // Google Play が数えた SNS からの DL も数日遅れて届くので、届いているいちばん新しい日で終わる 30 日
  const playEnd = utmEnd(daily.playUtm, today);
  const playConnected = isApp && (daily.stores.includes("google_play") || daily.playUtm.length > 0);
  const clicks: Daily[] | null = hasLinks ? daily.clicks : null;
  const published = daily.published;
  const draftCount = drafts;

  const cards = pickOverviewCards({
    today,
    productType,
    downloads: hasStore ? (store30.downloads ?? null) : null,
    clicks,
    published,
    scheduledCount: scheduled.count ?? 0,
    draftCount,
    kpis,
    kpiValues: overview.kpiValues,
    since: { clicks: daily.linksSince, posts: projectSince },
    playSnsDl: playConnected ? (playEnd ? { value: sumPlayUtm(daily.playUtm, addDays(playEnd, -(OVERVIEW_DAYS - 1)), playEnd).total, ...(playEnd < today ? { until: playEnd } : {}) } : { value: 0, notArrived: true as const }) : null,
  });

  return {
    today,
    cards,
    chart: downloads ? { kind: "downloads", rows: downloads, arrived: daily.arrived.downloads } : clicks ? { kind: "link_clicks", rows: clicks } : null,
    ...(downloads ? { hero7: overview.kpiValues.downloads } : {}),
    hasStore,
    hasLinks,
    stores: isApp ? daily.stores : [],
    clicksBySns: overview.clicksBySns.filter((c) => c.last30d > 0),
    topPost: overview.topPosts[0] ?? null,
  };
}
