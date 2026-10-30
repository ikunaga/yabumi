import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { toYmd } from "@/lib/time";

// 投稿をつくる画面の下の数字の帯（見本 B）。出せる数字だけを出す（出せないものは入れない。何もなければ null）。
// 送った投稿を開いたときはその投稿の数字、それ以外は前回送った投稿の数字
export type PostNumbers = {
  kind: "this" | "last";
  postId: string;
  publishedAt: string;
  sns: SnsKey[];
  // SNS で見られた数（取り込めた SNS と、手で入れた note・Substack の合計）。取れていなければ null
  views: number | null;
  // いいね（手で入れた note・Substack は「スキ」「Likes」）。取れていなければ null
  likes: number | null;
  // 短縮リンクが押された回数。短縮リンクがなければ null
  clicks: number | null;
};

// db を渡すと、そのクライアントで読む（テストでは利用者の権限のクライアントを渡す）
export async function loadPostNumbers(projectId: string, opts: { postId?: string | null; sent?: boolean } = {}, db?: SupabaseClient<Database>): Promise<PostNumbers | null> {
  const supabase = db ?? (await createClient());

  // どの投稿の数字を出すか
  let postId: string | null = opts.sent && opts.postId ? opts.postId : null;
  if (!postId) {
    let q = supabase
      .from("post_targets")
      .select("post_id, published_at, posts!inner(project_id)")
      .eq("posts.project_id", projectId)
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1);
    if (opts.postId) q = q.neq("post_id", opts.postId);
    const { data, error } = await q;
    if (error) throw error;
    postId = data?.[0]?.post_id ?? null;
  }
  if (!postId) return null;

  const { data: targets, error } = await supabase
    .from("post_targets")
    .select("id, sns, published_at, posts!inner(project_id)")
    .eq("post_id", postId)
    .eq("posts.project_id", projectId)
    .eq("status", "published");
  if (error) throw error;
  if (!targets?.length) return null;
  const ids = targets.map((t) => t.id);

  const [{ data: metrics, error: e1 }, { data: manual, error: e2 }, { data: links, error: e3 }] = await Promise.all([
    supabase.from("post_metrics").select("post_target_id, day_index, values").in("post_target_id", ids),
    supabase.from("manual_post_metrics").select("views, reactions").in("post_target_id", ids),
    supabase.from("short_links").select("id").in("post_target_id", ids),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  // SNS の数字は配信先ごとに最新の日（day_index がいちばん大きいもの）を使う
  const latest = new Map<string, { day: number; values: Record<string, unknown> }>();
  for (const m of metrics ?? []) {
    const cur = latest.get(m.post_target_id);
    if (!cur || m.day_index > cur.day) latest.set(m.post_target_id, { day: m.day_index, values: (m.values ?? {}) as Record<string, unknown> });
  }
  const sum = (rows: (number | null | undefined)[]) => {
    const nums = rows.filter((n): n is number => typeof n === "number");
    return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const snsValues = [...latest.values()].map((l) => l.values);
  const views = sum([...snsValues.map((v) => num(v.views)), ...(manual ?? []).map((m) => m.views)]);
  const likes = sum([...snsValues.map((v) => num(v.likes)), ...(manual ?? []).map((m) => m.reactions)]);

  // 押された回数は DB で数えたリンクごとの合計（link_click_totals）から、この投稿のリンクの分を足す
  let clicks: number | null = null;
  if (links?.length) {
    const { data: totals, error: e4 } = await supabase.rpc("link_click_totals", { p_project_id: projectId, p_today: toYmd(new Date()) });
    if (e4) throw e4;
    const mine = new Set(links.map((l) => l.id));
    clicks = (totals ?? []).filter((t) => mine.has(t.link_id)).reduce((n, t) => n + Number(t.clicks_total), 0);
  }

  if (views === null && likes === null && clicks === null) return null;
  const publishedAt = targets.map((t) => t.published_at!).sort()[0];
  return {
    kind: opts.sent && opts.postId === postId ? "this" : "last",
    postId,
    publishedAt,
    sns: targets.map((t) => t.sns).filter(isSnsKey),
    views,
    likes,
    clicks,
  };
}
