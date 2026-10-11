import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { hasInsightsScope, insightsEnabled } from "@/lib/sns/insights/scopes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SNS, isSnsKey, type SnsKey } from "@/lib/sns";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";
import { toYmd } from "@/lib/time";
import type { KpiKey } from "./kpis";

// 数字の画面（docs/architecture.md の 4.22）の読み込み。合計はすべて DB の関数で出す（行を読んで足さない）

// unit: 金額のときの通貨（JPY など）。数のときはなし
export type WeekValue = { thisWeek: number; lastWeek: number; unit?: string };
export type KpiValues = Partial<Record<KpiKey, WeekValue>>;

export type ClicksBySns = { sns: SnsKey | null; label: string; thisWeek: number; lastWeek: number; last30d: number };

export type MetricsOverview = {
  kpiValues: KpiValues;
  clicksBySns: ClicksBySns[];
  topPosts: { postId: string; title: string; clicks: number }[];
  topViewed: { postId: string; title: string; views: number }[];
};

// db を渡すと、そのクライアントで読む（AI と相談の「いまの状況」は、利用者の権限のクライアントを渡す。4.23）
export async function loadMetricsOverview(projectId: string, db?: SupabaseClient<Database>): Promise<MetricsOverview> {
  const supabase = db ?? (await createClient());
  const today = toYmd(new Date());
  const [
    { data: posts, error: e1 },
    { data: clicks, error: e2 },
    { data: top, error: e3 },
    { data: stores, error: e4 },
    { data: snsTotals, error: e5 },
    { data: topViews, error: e6 },
    { count: downloadDays },
    { count: revenueCatDays },
    { count: pageViewDays },
  ] = await Promise.all([
    supabase.rpc("weekly_post_totals", { p_project_id: projectId, p_today: today }),
    supabase.rpc("link_clicks_by_sns", { p_project_id: projectId, p_today: today }),
    supabase.rpc("top_posts_by_clicks", { p_project_id: projectId, p_today: today, p_days: 30, p_limit: 5 }),
    supabase.rpc("store_weekly_totals", { p_project_id: projectId, p_today: today }),
    supabase.rpc("sns_weekly_totals", { p_project_id: projectId, p_today: today }),
    supabase.rpc("top_posts_by_views", { p_project_id: projectId, p_today: today, p_days: 30, p_limit: 5 }),
    // 取り込んだことがある取り込み元（つないでいなければ、ダウンロード・課金は「つなぐと出ます」）
    supabase.from("store_daily").select("day", { count: "exact", head: true }).eq("project_id", projectId).in("source", ["app_store", "google_play"]),
    supabase.from("store_daily").select("day", { count: "exact", head: true }).eq("project_id", projectId).eq("source", "revenuecat"),
    supabase.from("store_daily").select("day", { count: "exact", head: true }).eq("project_id", projectId).in("source", ["app_store_views", "google_play"]),
  ]);
  if (e4) throw e4;
  if (e5) throw e5;
  if (e6) throw e6;
  const sns = snsTotals?.[0];
  // 閲覧数: SNS の数字（数字の権限つきでつないだもの）と、note・Substack で手で入れた数字の合計
  const hasViews = Boolean(sns?.has_post_metrics) || Number(p0(posts)?.manual_views_this_week ?? 0) + Number(p0(posts)?.manual_views_last_week ?? 0) > 0;
  const sources = new Set([...(downloadDays ? ["downloads"] : []), ...(revenueCatDays ? ["revenuecat"] : []), ...(pageViewDays ? ["page_views"] : [])]);
  const st = stores?.[0];
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const p = posts?.[0];
  const clicksBySns: ClicksBySns[] = (clicks ?? [])
    .map((c) => {
      const sns = isSnsKey(c.sns) ? c.sns : null;
      return { sns, label: sns ? SNS[sns].label : "SNS を決めていないリンク", thisWeek: Number(c.this_week), lastWeek: Number(c.last_week), last30d: Number(c.last_30d) };
    })
    .sort((a, b) => b.last30d - a.last30d);
  const sum = (key: "thisWeek" | "lastWeek") => clicksBySns.reduce((n, c) => n + c[key], 0);

  const ids = [...new Set([...(top ?? []).map((t) => t.post_id), ...(topViews ?? []).map((t) => t.post_id)])];
  const byId = new Map<string, string>();
  if (ids.length) {
    const { data: bodies } = await supabase.from("posts").select("id, body").in("id", ids);
    for (const b of bodies ?? []) byId.set(b.id, b.body);
  }
  const topPosts = (top ?? []).map((t) => ({ postId: t.post_id, title: firstLine(byId.get(t.post_id) ?? ""), clicks: Number(t.clicks) }));
  const topViewed = (topViews ?? []).map((t) => ({ postId: t.post_id, title: firstLine(byId.get(t.post_id) ?? ""), views: Number(t.views) }));

  return {
    kpiValues: {
      posts: { thisWeek: Number(p?.published_this_week ?? 0), lastWeek: Number(p?.published_last_week ?? 0) },
      link_clicks: { thisWeek: sum("thisWeek"), lastWeek: sum("lastWeek") },
      ...(hasViews
        ? {
            views: {
              thisWeek: Number(sns?.views_this_week ?? 0) + Number(p?.manual_views_this_week ?? 0),
              lastWeek: Number(sns?.views_last_week ?? 0) + Number(p?.manual_views_last_week ?? 0),
            },
          }
        : {}),
      ...(sns?.has_account_metrics && sns.followers_now != null
        ? { followers: { thisWeek: Number(sns.followers_now), lastWeek: Number(sns.followers_week_ago ?? sns.followers_now) } }
        : {}),
      ...(sources.has("downloads") ? { downloads: { thisWeek: Number(st?.downloads_this_week ?? 0), lastWeek: Number(st?.downloads_last_week ?? 0) } } : {}),
      ...(sources.has("page_views")
        ? { store_page_views: { thisWeek: Number(st?.page_views_this_week ?? 0), lastWeek: Number(st?.page_views_last_week ?? 0) } }
        : {}),
      ...(sources.has("revenuecat") && st?.revenue_latest != null
        ? { revenue: { thisWeek: Number(st.revenue_latest), lastWeek: Number(st.revenue_week_ago ?? st.revenue_latest), unit: st.revenue_currency ?? "JPY" } }
        : {}),
    },
    clicksBySns,
    topPosts,
    topViewed,
  };
}

function p0<T>(rows: T[] | null | undefined): T | undefined {
  return rows?.[0];
}

function firstLine(body: string) {
  const line = body.split("\n").find((l) => l.trim()) ?? "（本文なし）";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export type ManualTargetRow = {
  targetId: string;
  postId: string;
  sns: SnsKey;
  title: string;
  publishedAt: string;
  views: number | null;
  reactions: number | null;
};

// 手で投稿した note・Substack の配信先（直近 60 日、新しい順に 50 件）と、記録した数字
export async function listManualTargets(projectId: string): Promise<ManualTargetRow[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("post_targets")
    .select("id, post_id, sns, title, published_at, posts!inner(project_id, body), manual_post_metrics(views, reactions)")
    .eq("posts.project_id", projectId)
    .in("sns", ["note", "substack"])
    .eq("status", "published")
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((t) => {
    const m = (t.manual_post_metrics as unknown as { views: number | null; reactions: number | null } | null) ?? null;
    const post = t.posts as unknown as { body: string };
    return {
      targetId: t.id,
      postId: t.post_id,
      sns: t.sns as SnsKey,
      title: t.title || firstLine(post.body),
      publishedAt: t.published_at!,
      views: m?.views ?? null,
      reactions: m?.reactions ?? null,
    };
  });
}

// 数字の権限（SNS_INSIGHTS で有効にしたもの）なしでつないだ SNS。つなぎ直すと数字が出る。
// accounts は利用者の権限（RLS）で読んだ本人のアカウント。権限はトークンの表にあり画面側からは読めないので、サーバーの権限で読む
export async function snsNeedingInsightsReconnect(accounts: Partial<Record<SnsKey, string>>): Promise<SnsKey[]> {
  const entries = (Object.entries(accounts) as [SnsKey, string][]).filter(([sns]) => insightsEnabled(sns));
  if (!entries.length) return [];
  const { data, error } = await createAdminClient()
    .from("social_account_tokens")
    .select("social_account_id, scopes")
    .in("social_account_id", entries.map(([, id]) => id));
  if (error) throw error;
  const scopes = new Map((data ?? []).map((r) => [r.social_account_id, r.scopes]));
  return entries.filter(([sns, id]) => !hasInsightsScope(sns, scopes.get(id) ?? [])).map(([sns]) => sns);
}

// 本人の今月の X の数字の費用が上限に達しているか（次の 1 件を読めない）。X をつないでいて、X の数字が有効なときだけ確かめる
export async function xMetricsOverLimit(accounts: Partial<Record<SnsKey, string>>, userBudgetUsd: number): Promise<boolean> {
  if (!accounts.x || !insightsEnabled("x")) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_x_metrics_spend_this_month");
  if (error) throw error;
  return Number(data ?? 0) + X_PRICE_USD.metrics_read > userBudgetUsd;
}
