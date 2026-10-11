import "server-only";
import { createClient } from "@/lib/supabase/server";
import { SNS, isSnsKey, type SnsKey } from "@/lib/sns";
import { toYmd } from "@/lib/time";
import type { KpiKey } from "./kpis";

// 数字の画面（docs/architecture.md の 4.22）の読み込み。合計はすべて DB の関数で出す（行を読んで足さない）

export type WeekValue = { thisWeek: number; lastWeek: number };
export type KpiValues = Partial<Record<KpiKey, WeekValue>>;

export type ClicksBySns = { sns: SnsKey | null; label: string; thisWeek: number; lastWeek: number; last30d: number };

export type MetricsOverview = {
  kpiValues: KpiValues;
  clicksBySns: ClicksBySns[];
  topPosts: { postId: string; title: string; clicks: number }[];
};

export async function loadMetricsOverview(projectId: string): Promise<MetricsOverview> {
  const supabase = await createClient();
  const today = toYmd(new Date());
  const [{ data: posts, error: e1 }, { data: clicks, error: e2 }, { data: top, error: e3 }] = await Promise.all([
    supabase.rpc("weekly_post_totals", { p_project_id: projectId, p_today: today }),
    supabase.rpc("link_clicks_by_sns", { p_project_id: projectId, p_today: today }),
    supabase.rpc("top_posts_by_clicks", { p_project_id: projectId, p_today: today, p_days: 30, p_limit: 5 }),
  ]);
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

  let topPosts: MetricsOverview["topPosts"] = [];
  if (top?.length) {
    const { data: bodies } = await supabase.from("posts").select("id, body").in("id", top.map((t) => t.post_id));
    const byId = new Map((bodies ?? []).map((b) => [b.id, b.body]));
    topPosts = top.map((t) => ({ postId: t.post_id, title: firstLine(byId.get(t.post_id) ?? ""), clicks: Number(t.clicks) }));
  }

  return {
    kpiValues: {
      posts: { thisWeek: Number(p?.published_this_week ?? 0), lastWeek: Number(p?.published_last_week ?? 0) },
      link_clicks: { thisWeek: sum("thisWeek"), lastWeek: sum("lastWeek") },
      views: { thisWeek: Number(p?.manual_views_this_week ?? 0), lastWeek: Number(p?.manual_views_last_week ?? 0) },
    },
    clicksBySns,
    topPosts,
  };
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
