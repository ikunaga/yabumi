import "server-only";
import type { KpiKey } from "@/lib/metrics/kpis";
import { loadMetricsOverview, type ClicksBySns } from "@/lib/metrics/queries";
import { createClient } from "@/lib/supabase/server";
import { addDays, toYmd } from "@/lib/time";
import { OVERVIEW_DAYS, pickOverviewCards, type Daily, type OverviewCard } from "./numbers";

export type OverviewNumbers = {
  today: string;
  cards: OverviewCard[];
  // 日ごとの棒グラフ（ダウンロード、なければストアへのクリック。どちらもなければ null）
  chart: { kind: "downloads" | "link_clicks"; rows: Daily[] } | null;
  hasStore: boolean;
  hasLinks: boolean;
  // 直近 60 日に数字を取り込んだストア（見出しの札に出す）
  stores: ("app_store" | "google_play")[];
  clicksBySns: ClicksBySns[];
  // いちばんクリックされた投稿（30 日。スマホの概要に出す）
  topPost: { postId: string; title: string; clicks: number } | null;
};

// 概要の数字（直近 30 日と、その前の 30 日）。どれも本人だけが読める表と関数から読む（RLS）
export async function loadOverviewNumbers(projectId: string, kpis: KpiKey[]): Promise<OverviewNumbers> {
  const supabase = await createClient();
  const today = toYmd(new Date());
  const from = addDays(today, -(OVERVIEW_DAYS * 2 - 1));
  const [overview, daily, store, links, scheduled, drafts] = await Promise.all([
    loadMetricsOverview(projectId, supabase),
    // 送った投稿と、短縮リンクのクリックの日ごと（ロードマップと同じ数え方）
    supabase.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: from, p_to: today }),
    supabase.from("store_daily").select("day, source, values").eq("project_id", projectId).in("source", ["app_store", "google_play"]).gte("day", from),
    supabase.from("short_links").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "scheduled").gte("planned_at", new Date().toISOString()),
    // 下書き: 予約していない投稿のうち、どこにも送っていないもの（今すぐ送った投稿は下書きの状態のまま送られる）
    supabase.from("posts").select("id, post_targets(status)").eq("project_id", projectId).eq("status", "draft"),
  ]);
  if (daily.error) throw daily.error;
  if (store.error) throw store.error;
  if (links.error) throw links.error;
  if (scheduled.error) throw scheduled.error;
  if (drafts.error) throw drafts.error;

  // ダウンロードは、ストアから取り込んだことがあるときだけ（分析の画面と同じ判定）
  const hasStore = Boolean(overview.kpiValues.downloads);
  const hasLinks = (links.count ?? 0) > 0;
  const downloads: Daily[] | null = hasStore ? (store.data ?? []).map((r) => ({ day: r.day, value: Number((r.values as { downloads?: number } | null)?.downloads ?? 0) })) : null;
  const clicks: Daily[] | null = hasLinks ? (daily.data ?? []).map((r) => ({ day: r.day, value: Number(r.link_clicks) })) : null;
  const published: Daily[] = (daily.data ?? []).map((r) => ({ day: r.day, value: Number(r.posts) }));
  const draftCount = (drafts.data ?? []).filter((p) => p.post_targets.every((t) => t.status === "pending")).length;

  const cards = pickOverviewCards({
    today,
    downloads,
    clicks,
    published,
    scheduledCount: scheduled.count ?? 0,
    draftCount,
    kpis,
    kpiValues: overview.kpiValues,
  });

  return {
    today,
    cards,
    chart: downloads ? { kind: "downloads", rows: downloads } : clicks ? { kind: "link_clicks", rows: clicks } : null,
    hasStore,
    hasLinks,
    stores: (["app_store", "google_play"] as const).filter((s) => (store.data ?? []).some((r) => r.source === s)),
    clicksBySns: overview.clicksBySns.filter((c) => c.last30d > 0),
    topPost: overview.topPosts[0] ?? null,
  };
}
