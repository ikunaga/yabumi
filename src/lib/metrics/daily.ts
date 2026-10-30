import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Daily } from "@/lib/overview/numbers";
import type { Database } from "@/lib/supabase/database.types";
import { addDays } from "@/lib/time";

export type StoreSource = "app_store" | "google_play";

export type DailyNumbers = {
  // 送った投稿（SNS ごとに 1 と数える）と、短縮リンクのクリック（ロードマップと同じ数え方。roadmap_daily_totals）
  published: Daily[];
  clicks: Daily[];
  // ストアのダウンロードとストアのページの閲覧（store_daily。App Store と Google Play の合計）
  downloads: Daily[];
  pageViews: Daily[];
  // 期間の中で数字を取り込んだストア
  stores: StoreSource[];
};

// 概要と分析の日ごとの数（today を含む直近 days 日）。どれも本人だけが読める表と関数から読む（RLS）
export async function loadDailyNumbers(supabase: SupabaseClient<Database>, projectId: string, today: string, days: number): Promise<DailyNumbers> {
  const from = addDays(today, -(days - 1));
  const [totals, store] = await Promise.all([
    supabase.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: from, p_to: today }),
    supabase.from("store_daily").select("day, source, values").eq("project_id", projectId).in("source", ["app_store", "google_play", "app_store_views"]).gte("day", from),
  ]);
  if (totals.error) throw totals.error;
  if (store.error) throw store.error;
  const rows = store.data ?? [];
  const value = (v: unknown, key: string) => Number((v as Record<string, number> | null)?.[key] ?? 0);
  return {
    published: (totals.data ?? []).map((r) => ({ day: r.day, value: Number(r.posts) })),
    clicks: (totals.data ?? []).map((r) => ({ day: r.day, value: Number(r.link_clicks) })),
    downloads: rows.filter((r) => r.source !== "app_store_views").map((r) => ({ day: r.day, value: value(r.values, "downloads") })),
    // ページの閲覧: App Store はレポート（app_store_views）、Google Play は同じ行の page_views（store_weekly_totals と同じ）
    pageViews: rows.filter((r) => r.source !== "app_store").map((r) => ({ day: r.day, value: value(r.values, "page_views") })),
    stores: (["app_store", "google_play"] as const).filter((s) => rows.some((r) => r.source === s)),
  };
}
