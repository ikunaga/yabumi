import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Daily } from "@/lib/overview/numbers";
import type { PlayUtmRow } from "./play-utm";
import type { Database } from "@/lib/supabase/database.types";
import { addDays, toYmd } from "@/lib/time";

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
  // ストアごとの、取り込んだいちばん新しい日（確定した日だけで比べるため。post-effect.ts）
  lastStoreDay: Partial<Record<StoreSource, string>>;
  // 数え始めた日（比べる範囲の始まり。それより前は数えていないので 0 と扱わない）。
  // ダウンロードは期間の中で取り込んだいちばん古い日、クリックはいちばん古い短縮リンクを作った日（日本時間）。なければ null
  storeSince: string | null;
  linksSince: string | null;
  // 手で記録した成果の日ごと（決定 D34。記録のない日は入らない）
  outcomes: Daily[];
  // Google Play が数えた、yabumi の短縮リンクごとの DL（日ごと。数字の段 3）と、流入元のレポートを読めなかった日があったか
  playUtm: PlayUtmRow[];
  playUtmUnreadable: boolean;
  // Apple が数えた、yabumi のキャンペーンリンク（ct）ごとのはじめてのダウンロード（日ごと。数字の段 5）。other は使わない（0）
  appleCampaigns: PlayUtmRow[];
  appleCampaignsUnreadable: boolean;
  // App Store のページの閲覧数のレポートを読んでいるか（Analytics Reports の依頼をしている印。キャンペーンもこの依頼で読む）
  appleReports: boolean;
};

// 概要と分析の日ごとの数（today を含む直近 days 日）。どれも本人だけが読める表と関数から読む（RLS）
export async function loadDailyNumbers(supabase: SupabaseClient<Database>, projectId: string, today: string, days: number): Promise<DailyNumbers> {
  const from = addDays(today, -(days - 1));
  const [totals, store, firstLink, outcomeRows] = await Promise.all([
    supabase.rpc("roadmap_daily_totals", { p_project_id: projectId, p_from: from, p_to: today }),
    supabase.from("store_daily").select("day, source, values").eq("project_id", projectId).in("source", ["app_store", "google_play", "app_store_views", "app_store_campaigns"]).gte("day", from),
    supabase.from("short_links").select("created_at").eq("project_id", projectId).order("created_at").limit(1).maybeSingle(),
    supabase.from("project_outcomes_daily").select("day, count").eq("project_id", projectId).gte("day", from),
  ]);
  if (outcomeRows.error) throw outcomeRows.error;
  if (firstLink.error) throw firstLink.error;
  if (totals.error) throw totals.error;
  if (store.error) throw store.error;
  const rows = store.data ?? [];
  const value = (v: unknown, key: string) => Number((v as Record<string, number> | null)?.[key] ?? 0);
  return {
    published: (totals.data ?? []).map((r) => ({ day: r.day, value: Number(r.posts) })),
    clicks: (totals.data ?? []).map((r) => ({ day: r.day, value: Number(r.link_clicks) })),
    downloads: rows.filter((r) => r.source === "app_store" || r.source === "google_play").map((r) => ({ day: r.day, value: value(r.values, "downloads") })),
    // ページの閲覧: App Store はレポート（app_store_views）、Google Play は同じ行の page_views（store_weekly_totals と同じ）
    pageViews: rows.filter((r) => r.source === "app_store_views" || r.source === "google_play").map((r) => ({ day: r.day, value: value(r.values, "page_views") })),
    stores: (["app_store", "google_play"] as const).filter((s) => rows.some((r) => r.source === s)),
    outcomes: Object.entries(
      (outcomeRows.data ?? []).reduce<Record<string, number>>((m, r) => ({ ...m, [r.day]: (m[r.day] ?? 0) + r.count }), {}),
    ).map(([day, value]) => ({ day, value })),
    playUtm: rows.flatMap((r) => {
      const u = r.source === "google_play" ? (r.values as { utm?: Omit<PlayUtmRow, "day"> } | null)?.utm : undefined;
      return u ? [{ day: r.day, by_source: u.by_source ?? {}, by_campaign: u.by_campaign ?? {}, other: Number(u.other ?? 0) }] : [];
    }),
    appleCampaigns: rows.flatMap((r) => {
      const v = r.source === "app_store_campaigns" ? (r.values as { by_source?: Record<string, number>; by_campaign?: Record<string, number>; unreadable?: boolean } | null) : null;
      return v && !v.unreadable ? [{ day: r.day, by_source: v.by_source ?? {}, by_campaign: v.by_campaign ?? {}, other: 0 }] : [];
    }),
    appleReports: rows.some((r) => r.source === "app_store_views" || r.source === "app_store_campaigns"),
    appleCampaignsUnreadable: rows.some((r) => r.source === "app_store_campaigns" && Boolean((r.values as { unreadable?: boolean } | null)?.unreadable)),
    playUtmUnreadable: rows.some((r) => r.source === "google_play" && Boolean((r.values as { utm_unreadable?: boolean } | null)?.utm_unreadable)),
    storeSince: rows.filter((r) => r.source === "app_store" || r.source === "google_play").map((r) => r.day).sort()[0] ?? null,
    linksSince: firstLink.data ? toYmd(new Date(firstLink.data.created_at)) : null,
    lastStoreDay: Object.fromEntries(
      (["app_store", "google_play"] as const).flatMap((s) => {
        const days = rows.filter((r) => r.source === s).map((r) => r.day).sort();
        return days.length ? [[s, days[days.length - 1]]] : [];
      }),
    ),
  };
}
