import "server-only";
import type { KpiKey } from "@/lib/metrics/kpis";
import { loadMetricsOverview, type ClicksBySns, type MetricsOverview } from "@/lib/metrics/queries";
import { createClient } from "@/lib/supabase/server";
import { addDays, toYmd } from "@/lib/time";
import { sumPlayUtm } from "@/lib/metrics/play-utm";
import { loadDailyNumbers, type StoreSource } from "@/lib/metrics/daily";
import { OVERVIEW_DAYS, pickOverviewCards, type Daily, type OverviewCard } from "./numbers";

export type OverviewNumbers = {
  today: string;
  cards: OverviewCard[];
  // 日ごとの棒グラフ（ダウンロード、なければストアへのクリック。どちらもなければ null）
  chart: { kind: "downloads" | "link_clicks"; rows: Daily[] } | null;
  hasStore: boolean;
  hasLinks: boolean;
  // 直近 60 日に数字を取り込んだストア（見出しの札に出す）
  stores: StoreSource[];
  clicksBySns: ClicksBySns[];
  // いちばんクリックされた投稿（30 日。スマホの概要に出す）
  topPost: MetricsOverview["topPosts"][number] | null;
};

// 概要の数字（直近 30 日と、その前の 30 日）。どれも本人だけが読める表と関数から読む（RLS）
// projectSince: プロジェクトを作った日（日本時間の YYYY-MM-DD。投稿数の前の 30 日がこれより前なら比べない）
export async function loadOverviewNumbers(projectId: string, kpis: KpiKey[], projectSince?: string, productType?: string): Promise<OverviewNumbers> {
  const supabase = await createClient();
  const today = toYmd(new Date());
  const [overview, daily, links, scheduled, drafts] = await Promise.all([
    loadMetricsOverview(projectId, supabase),
    // 直近 30 日と前の 30 日
    loadDailyNumbers(supabase, projectId, today, OVERVIEW_DAYS * 2),
    supabase.from("short_links").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "scheduled").gte("planned_at", new Date().toISOString()),
    // 下書き: 予約していない投稿のうち、どこにも送っていないもの（今すぐ送った投稿は下書きの状態のまま送られる）
    supabase.from("posts").select("id, post_targets(status)").eq("project_id", projectId).eq("status", "draft"),
  ]);
  if (links.error) throw links.error;
  if (scheduled.error) throw scheduled.error;
  if (drafts.error) throw drafts.error;

  // ダウンロードは、ストアから取り込んだことがあるときだけ（分析の画面と同じ判定）
  const hasStore = Boolean(overview.kpiValues.downloads);
  const hasLinks = (links.count ?? 0) > 0;
  const downloads: Daily[] | null = hasStore ? daily.downloads : null;
  const clicks: Daily[] | null = hasLinks ? daily.clicks : null;
  const published = daily.published;
  const draftCount = (drafts.data ?? []).filter((p) => p.post_targets.every((t) => t.status === "pending")).length;

  const cards = pickOverviewCards({
    today,
    productType,
    downloads,
    clicks,
    published,
    scheduledCount: scheduled.count ?? 0,
    draftCount,
    kpis,
    kpiValues: overview.kpiValues,
    since: { downloads: daily.storeSince, clicks: daily.linksSince, posts: projectSince },
    playSnsDl: daily.stores.includes("google_play") || daily.playUtm.length ? sumPlayUtm(daily.playUtm, addDays(today, -(OVERVIEW_DAYS - 1)), today).total : null,
  });

  return {
    today,
    cards,
    chart: downloads ? { kind: "downloads", rows: downloads } : clicks ? { kind: "link_clicks", rows: clicks } : null,
    hasStore,
    hasLinks,
    stores: daily.stores,
    clicksBySns: overview.clicksBySns.filter((c) => c.last30d > 0),
    topPost: overview.topPosts[0] ?? null,
  };
}
