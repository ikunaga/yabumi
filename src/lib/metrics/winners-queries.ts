import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePlan } from "@/lib/plan/schema";
import { cleanSeries, isSeries } from "@/lib/post-formats/series";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import type { Database } from "@/lib/supabase/database.types";
import { toYmd } from "@/lib/time";
import { firstLine } from "./post-meta";
import { EXCLUDED_SNS, LOOKBACK_DAYS, SETTLE_DAYS, judgeWinners, metricForGoal, type TargetNumbers, type Winner, type WinnersJudge } from "./winners";

// 伸びた投稿を読む（docs/design/winning-posts.md の 2.）。利用者の権限のクライアントで読む（RLS で本人のものだけ）。AI は呼ばない。
// 判定の結果は DB に持たず、開くたびに計算する

type Db = SupabaseClient<Database>;

export type WinnerPost = Winner & {
  title: string; // 本文の 1 行目
  body: string; // 投稿の本文（伸びた SNS に SNS ごとの文があればそれ）
  formatId: string | null;
  formatName: string | null;
  formatSeries: boolean; // そのフォーマットに AI が埋める空欄があるか（自動投稿のシリーズで使えるか）
  autoPlanId: string | null; // そのフォーマットで回している自動投稿（あれば）
};

export type WinnersView = Omit<WinnersJudge, "winners"> & { winners: WinnerPost[] };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function loadWinners(db: Db, projectId: string, now: Date = new Date()): Promise<WinnersView> {
  const from = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const until = new Date(now.getTime() - SETTLE_DAYS * 86_400_000).toISOString();
  const [{ data: planRow, error: e0 }, { data: targets, error: e1 }] = await Promise.all([
    db.from("account_plans").select("data").eq("project_id", projectId).maybeSingle(),
    db
      .from("post_targets")
      .select("id, post_id, sns, published_at, body_override, posts!inner(project_id, body, format_id)")
      .eq("posts.project_id", projectId)
      .eq("status", "published")
      .is("sns_removed_at", null)
      .is("quote_post_id", null)
      .not("sns", "in", `(${EXCLUDED_SNS.join(",")})`)
      .gte("published_at", from)
      .lte("published_at", until),
  ]);
  if (e0) throw e0;
  if (e1) throw e1;
  const metric = metricForGoal(planRow ? normalizePlan(planRow.data, "").goal.goalType : null);
  const rows = (targets ?? []).filter((t) => isSnsKey(t.sns) && t.published_at);
  if (!rows.length) return { metric, bySns: [], winners: [] };
  const ids = rows.map((t) => t.id);

  const [{ data: metrics, error: e2 }, { data: manual, error: e3 }, { data: links, error: e4 }] = await Promise.all([
    db.from("post_metrics").select("post_target_id, day_index, values").in("post_target_id", ids),
    db.from("manual_post_metrics").select("post_target_id, views").in("post_target_id", ids),
    db.from("short_links").select("id, post_target_id").in("post_target_id", ids),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;

  // SNS の数字は配信先ごとに最新の日（day_index がいちばん大きいもの）を使う（src/lib/posts/numbers.ts と同じ）
  const latest = new Map<string, { day: number; views: number | null }>();
  for (const m of metrics ?? []) {
    const cur = latest.get(m.post_target_id);
    if (!cur || m.day_index > cur.day) latest.set(m.post_target_id, { day: m.day_index, views: num((m.values as Record<string, unknown> | null)?.views) });
  }
  const manualViews = new Map((manual ?? []).map((m) => [m.post_target_id, m.views]));
  const clicksByTarget = new Map<string, number>();
  if (links?.length) {
    const { data: totals, error: e5 } = await db.rpc("link_click_totals", { p_project_id: projectId, p_today: toYmd(now) });
    if (e5) throw e5;
    const byLink = new Map((totals ?? []).map((t) => [t.link_id, Number(t.clicks_total)]));
    for (const l of links) if (l.post_target_id) clicksByTarget.set(l.post_target_id, (clicksByTarget.get(l.post_target_id) ?? 0) + (byLink.get(l.id) ?? 0));
  }

  const input: TargetNumbers[] = rows.map((t) => ({
    targetId: t.id,
    postId: t.post_id,
    sns: t.sns as SnsKey,
    publishedAt: t.published_at!,
    views: latest.get(t.id)?.views ?? manualViews.get(t.id) ?? null,
    clicks: clicksByTarget.has(t.id) ? clicksByTarget.get(t.id)! : null,
  }));
  const judged = judgeWinners(input, { metric, now });
  if (!judged.winners.length) return { ...judged, winners: [] };

  const formatIds = [...new Set(judged.winners.map((w) => rows.find((r) => r.post_id === w.postId)?.posts.format_id).filter((x): x is string => !!x))];
  const [{ data: formats, error: e6 }, { data: plans, error: e7 }] = await Promise.all([
    formatIds.length ? db.from("post_formats").select("id, name, series").in("id", formatIds) : Promise.resolve({ data: [] as { id: string; name: string; series: unknown }[], error: null }),
    formatIds.length
      ? db.from("auto_plans").select("id, materials").eq("project_id", projectId).eq("kind", "series").in("status", ["active", "paused"])
      : Promise.resolve({ data: [] as { id: string; materials: unknown }[], error: null }),
  ]);
  if (e6) throw e6;
  if (e7) throw e7;
  const formatName = new Map((formats ?? []).map((f) => [f.id, f.name]));
  const seriesFormats = new Set((formats ?? []).filter((f) => isSeries(cleanSeries(f.series))).map((f) => f.id));
  const planByFormat = new Map<string, string>();
  for (const p of plans ?? []) {
    const f = (p.materials as { format_id?: unknown } | null)?.format_id;
    if (typeof f === "string" && !planByFormat.has(f)) planByFormat.set(f, p.id);
  }

  return {
    ...judged,
    winners: judged.winners.map((w) => {
      const targetsOfPost = rows.filter((r) => r.post_id === w.postId);
      const post = targetsOfPost[0].posts;
      const own = targetsOfPost.find((r) => r.sns === w.best.sns)?.body_override?.trim();
      const body = own || post.body;
      // 消したフォーマットの id は残らない（posts.format_id は on delete set null）が、読めなければ無いものとして扱う
      const formatId = post.format_id && formatName.has(post.format_id) ? post.format_id : null;
      return {
        ...w,
        title: firstLine(body),
        body,
        formatId,
        formatName: formatId ? formatName.get(formatId)! : null,
        formatSeries: formatId ? seriesFormats.has(formatId) : false,
        autoPlanId: formatId ? (planByFormat.get(formatId) ?? null) : null,
      };
    }),
  };
}
