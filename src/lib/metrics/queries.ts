import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { hasInsightsScope, insightsEnabled } from "@/lib/sns/insights/scopes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SNS, isSnsKey, type SnsKey } from "@/lib/sns";
import { X_PRICE_USD } from "@/lib/sns/x/pricing";
import { addDays, toYmd } from "@/lib/time";
import type { KpiKey } from "./kpis";
import { firstLine, postMeta, type PostMeta } from "./post-meta";
import { arrivedUntil } from "@/lib/overview/numbers";
import { loadConnectedStoreSources } from "./daily";
import { storeEnd, storeWeekValue, type StoreSpan } from "./store-period";

// 数字の画面（docs/architecture.md の 4.22）の読み込み。合計はすべて DB の関数で出す（行を読んで足さない）

// thisWeek・lastWeek: 直近の期間と、その前の期間（既定は 7 日。loadMetricsOverview の days）。名前は前の版（週だけだった）のまま。
// unit: 金額のときの通貨（JPY など）。数のときはなし
// noPrev: 前の期間の記録がない（フォロワーを記録し始めて間もないなど）。画面では比べない（lastWeek は thisWeek と同じ値にしてある）
// until: 遅れて届く数字（ダウンロード・ストアのページの閲覧）を、今日ではなくこの日（届いているいちばん新しい日）で終わる期間で数えたとき。
// notArrived: ストアをつないでいるが、どのストアからもまだ届いていない（数は出さない。thisWeek・lastWeek は 0）
export type WeekValue = { thisWeek: number; lastWeek: number; unit?: string; noPrev?: true; until?: string; notArrived?: true };
export type KpiValues = Partial<Record<KpiKey, WeekValue>>;

export type ClicksBySns = { sns: SnsKey | null; label: string; thisWeek: number; lastWeek: number; last30d: number };

export type MetricsOverview = {
  kpiValues: KpiValues;
  clicksBySns: ClicksBySns[];
  // 投稿の行（本文の 1 行目・送った日時・送った SNS。post-meta.ts）
  topPosts: (PostMeta & { postId: string; clicks: number })[];
  topViewed: (PostMeta & { postId: string; views: number })[];
};

// 分析の期間（数字の段 2）。画面で選べるのは 7 日と 30 日だけ（DB の関数もこれ以外は弾く）
export const METRICS_PERIODS = [7, 30] as const;
export type MetricsPeriod = (typeof METRICS_PERIODS)[number];

// db を渡すと、そのクライアントで読む（AI と相談の「いまの状況」は、利用者の権限のクライアントを渡す。4.23）。
// days: 直近 days 日と、その前の days 日を比べる（WeekValue の thisWeek・lastWeek に入る）。売上だけは RevenueCat の 28 日のまま。
// よく見られた投稿・クリックの多い投稿は、期間によらず 30 日
export async function loadMetricsOverview(projectId: string, db?: SupabaseClient<Database>, days: MetricsPeriod = 7): Promise<MetricsOverview> {
  const supabase = db ?? (await createClient());
  const today = toYmd(new Date());
  const [
    { data: totals, error: e1 },
    { data: clicks, error: e2 },
    { data: top, error: e3 },
    { data: topViews, error: e6 },
    store,
    { count: revenueCatDays },
    { data: outcomeRows, error: e7 },
    { data: firstOutcome },
  ] = await Promise.all([
    supabase.rpc("metrics_period_totals", { p_project_id: projectId, p_today: today, p_days: days }),
    supabase.rpc("link_clicks_by_sns_period", { p_project_id: projectId, p_today: today, p_days: days }),
    supabase.rpc("top_posts_by_clicks", { p_project_id: projectId, p_today: today, p_days: 30, p_limit: 5 }),
    supabase.rpc("top_posts_by_views", { p_project_id: projectId, p_today: today, p_days: 30, p_limit: 5 }),
    // ダウンロード・ストアのページの閲覧（届いている日で終わる期間。取り込んだことがなければ出さず「つなぐと出ます」）
    loadStoreTotals(supabase, projectId, today, days),
    // 取り込んだことがある取り込み元（つないでいなければ、課金は「つなぐと出ます」）
    supabase.from("store_daily").select("day", { count: "exact", head: true }).eq("project_id", projectId).eq("source", "revenuecat"),
    // 手で記録した成果（決定 D34）。直近の期間とその前の期間の分
    supabase.from("project_outcomes_daily").select("day, count").eq("project_id", projectId).gte("day", addDays(today, -(days * 2 - 1))),
    supabase.from("project_outcomes_daily").select("day").eq("project_id", projectId).order("day").limit(1).maybeSingle(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e6) throw e6;
  if (e7) throw e7;
  // 成果: 記録が 1 日でもあれば出す。記録し始めたのが前の期間の始まりより後なら比べない（記録する前の日を 0 と取り違えないように）
  const outcomeNow = (outcomeRows ?? []).filter((r) => r.day > addDays(today, -days)).reduce((n, r) => n + r.count, 0);
  const outcomePrev = (outcomeRows ?? []).filter((r) => r.day <= addDays(today, -days)).reduce((n, r) => n + r.count, 0);
  const t = totals?.[0];
  // 閲覧数: SNS の数字（数字の権限つきでつないだもの）と、note・Substack で手で入れた数字の合計
  const hasViews = Boolean(t?.has_post_metrics) || Number(t?.manual_views_now ?? 0) + Number(t?.manual_views_prev ?? 0) > 0;
  const sources = new Set(revenueCatDays ? ["revenuecat"] : []);

  const clicksBySns: ClicksBySns[] = (clicks ?? [])
    .map((c) => {
      const sns = isSnsKey(c.sns) ? c.sns : null;
      return { sns, label: sns ? SNS[sns].label : "SNS を決めていないリンク", thisWeek: Number(c.clicks_now), lastWeek: Number(c.clicks_prev), last30d: Number(c.last_30d) };
    })
    .sort((a, b) => b.last30d - a.last30d);
  const sum = (key: "thisWeek" | "lastWeek") => clicksBySns.reduce((n, c) => n + c[key], 0);

  const ids = [...new Set([...(top ?? []).map((t) => t.post_id), ...(topViews ?? []).map((t) => t.post_id)])];
  const byId = new Map<string, Parameters<typeof postMeta>[0]>();
  if (ids.length) {
    const { data: rows } = await supabase.from("posts").select("id, body, planned_at, post_targets(sns, status, published_at)").in("id", ids);
    for (const r of rows ?? []) byId.set(r.id, r);
  }
  const topPosts = (top ?? []).map((t) => ({ postId: t.post_id, ...postMeta(byId.get(t.post_id)), clicks: Number(t.clicks) }));
  const topViewed = (topViews ?? []).map((t) => ({ postId: t.post_id, ...postMeta(byId.get(t.post_id)), views: Number(t.views) }));

  return {
    kpiValues: {
      posts: { thisWeek: Number(t?.published_now ?? 0), lastWeek: Number(t?.published_prev ?? 0) },
      link_clicks: { thisWeek: sum("thisWeek"), lastWeek: sum("lastWeek") },
      ...(hasViews
        ? {
            views: {
              thisWeek: Number(t?.views_now ?? 0) + Number(t?.manual_views_now ?? 0),
              lastWeek: Number(t?.views_prev ?? 0) + Number(t?.manual_views_prev ?? 0),
            },
          }
        : {}),
      ...(t?.has_account_metrics && t.followers_now != null
        ? { followers: { thisWeek: Number(t.followers_now), lastWeek: Number(t.followers_ago ?? t.followers_now), ...(t.followers_ago == null ? { noPrev: true as const } : {}) } }
        : {}),
      ...store,
      ...(outcomeRows?.length
        ? (() => {
            const known = Boolean(firstOutcome && firstOutcome.day <= addDays(today, -(days * 2 - 1)));
            return { outcomes: { thisWeek: outcomeNow, lastWeek: known ? outcomePrev : outcomeNow, ...(known ? {} : { noPrev: true as const }) } };
          })()
        : {}),
      ...(sources.has("revenuecat") && t?.revenue_latest != null
        ? { revenue: { thisWeek: Number(t.revenue_latest), lastWeek: Number(t.revenue_week_ago ?? t.revenue_latest), unit: t.revenue_currency ?? "JPY" } }
        : {}),
    },
    clicksBySns,
    topPosts,
    topViewed,
  };
}

const DOWNLOAD_SOURCES = ["app_store", "google_play"] as const;
const PAGE_VIEW_SOURCES = ["app_store_views", "google_play"] as const;

// 遅れて届く数字の、数え始めた日（取り込んだいちばん古い日）と、すべてのストアから届いているいちばん新しい日（直近 60 日の中で。
// いまつないでいるストアの中だけで。日ごとの棒グラフと同じ決め方。src/lib/metrics/daily.ts）。取り込んだことがなければ since は null（StoreSpan）
export async function loadStoreSpans(supabase: SupabaseClient<Database>, projectId: string, today: string): Promise<{ downloads: StoreSpan; pageViews: StoreSpan }> {
  const first = (sources: readonly string[]) => supabase.from("store_daily").select("day").eq("project_id", projectId).in("source", sources).order("day").limit(1).maybeSingle();
  const [recent, dl, pv, connected] = await Promise.all([
    supabase.from("store_daily").select("day, source").eq("project_id", projectId).in("source", ["app_store", "google_play", "app_store_views"]).gte("day", addDays(today, -59)),
    first(DOWNLOAD_SOURCES),
    first(PAGE_VIEW_SOURCES),
    loadConnectedStoreSources(supabase, projectId),
  ]);
  if (recent.error) throw recent.error;
  if (dl.error) throw dl.error;
  if (pv.error) throw pv.error;
  const rows = recent.data ?? [];
  return {
    downloads: { since: dl.data?.day ?? null, until: arrivedUntil(rows, DOWNLOAD_SOURCES, connected) },
    pageViews: { since: pv.data?.day ?? null, until: arrivedUntil(rows, PAGE_VIEW_SOURCES, connected) },
  };
}

// ダウンロード・ストアのページの閲覧の、届いている日で終わる days 日とその前の days 日（DB の関数 store_period_totals。終わりの日より後の行は入れない）
export async function loadStoreTotals(supabase: SupabaseClient<Database>, projectId: string, today: string, days: MetricsPeriod): Promise<Pick<KpiValues, "downloads" | "store_page_views">> {
  const spans = await loadStoreSpans(supabase, projectId, today);
  const ends = [...new Set([spans.downloads, spans.pageViews].filter((s) => s.since && s.until).map((s) => storeEnd(today, s.until)))];
  const totals = new Map(
    await Promise.all(
      ends.map(async (end) => {
        const { data, error } = await supabase.rpc("store_period_totals", { p_project_id: projectId, p_end: end, p_days: days });
        if (error) throw error;
        return [end, data?.[0]] as const;
      }),
    ),
  );
  const downloads = storeWeekValue(spans.downloads, today, days, (end) => {
    const t = totals.get(end);
    return t ? { now: Number(t.downloads_now ?? 0), prev: Number(t.downloads_prev ?? 0) } : null;
  });
  const pageViews = storeWeekValue(spans.pageViews, today, days, (end) => {
    const t = totals.get(end);
    return t ? { now: Number(t.page_views_now ?? 0), prev: Number(t.page_views_prev ?? 0) } : null;
  });
  return { ...(downloads ? { downloads } : {}), ...(pageViews ? { store_page_views: pageViews } : {}) };
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
