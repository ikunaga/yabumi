import "server-only";
import { isSnsKey, type SnsKey } from "@/lib/sns";
import { postTitle } from "@/lib/posts/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildPostComments, newCommentSummary, type CommentRowIn, type PostCommentsView, type TargetIn } from "./view";
import { commentsEnabled, hasCommentsScope } from "./scopes";

// コメントの画面・概要の帯・投稿の画面の読み方（docs/architecture.md の 4.70）。利用者のクライアント（RLS）で、本人の行だけを読む
const COLS = "id, post_target_id, sns, parent_external_id, author_name, body, is_own, commented_at, seen_at";
// コメントは 30 日で消すので、それより前に送った投稿は見ない
const WINDOW_DAYS = 30;

type TargetRow = { id: string; post_id: string; sns: string; published_at: string | null; external_url: string | null; posts: { body: string } };

export async function loadProjectComments(projectId: string, opts: { postId?: string } = {}): Promise<PostCommentsView[]> {
  const supabase = await createClient();
  let q = supabase
    .from("post_targets")
    .select("id, post_id, sns, published_at, external_url, posts!inner(project_id, body)")
    .eq("posts.project_id", projectId)
    .eq("status", "published")
    .in("sns", ["threads", "instagram", "facebook", "x"])
    .gte("published_at", new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString());
  if (opts.postId) q = q.eq("post_id", opts.postId);
  const { data: targets, error } = await q;
  if (error) throw error;
  const rows = (targets ?? []) as unknown as TargetRow[];
  if (!rows.length) return [];
  const ids = rows.map((t) => t.id);
  const [{ data: comments, error: e1 }, { data: metrics, error: e2 }] = await Promise.all([
    supabase.from("sns_comments").select(COLS).in("post_target_id", ids),
    supabase.from("post_metrics").select("post_target_id, day_index, values").in("post_target_id", ids),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  // 毎日の数字の最新の日（day_index がいちばん大きいもの）
  const latest = new Map<string, { day: number; values: Record<string, unknown> }>();
  for (const m of metrics ?? []) {
    const cur = latest.get(m.post_target_id);
    if (!cur || m.day_index > cur.day) latest.set(m.post_target_id, { day: m.day_index, values: (m.values ?? {}) as Record<string, unknown> });
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ins: TargetIn[] = rows.flatMap((t) =>
    isSnsKey(t.sns) && t.published_at
      ? [
          {
            id: t.id,
            postId: t.post_id,
            sns: t.sns,
            title: postTitle(t.posts.body, 30),
            publishedAt: t.published_at,
            url: t.external_url,
            likes: num(latest.get(t.id)?.values.likes),
            replies: num(latest.get(t.id)?.values.replies),
          },
        ]
      : [],
  );
  return buildPostComments(ins, (comments ?? []) as CommentRowIn[]);
}

// 概要の帯: まだ見ていない、自分のものでないコメントの数
export async function loadNewCommentSummary(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sns_comments")
    .select("sns, is_own, seen_at, post_targets!inner(posts!inner(project_id))")
    .eq("post_targets.posts.project_id", projectId)
    .eq("is_own", false)
    .is("seen_at", null)
    .limit(1000);
  if (error) throw error;
  return newCommentSummary(data ?? []);
}

// コメントの権限なしでつないでいて、つなぎ直しが要る SNS。accounts は本人のプロジェクトにつないだアカウント（SNS → social_accounts.id）。
// トークンの表は利用者から読めないので、サーバーのクライアントで、渡した ID の権限だけを読む
export async function snsNeedingCommentsReconnect(accounts: Partial<Record<SnsKey, string>>): Promise<SnsKey[]> {
  const entries = (Object.entries(accounts) as [SnsKey, string][]).filter(([sns]) => commentsEnabled(sns));
  if (!entries.length) return [];
  const { data, error } = await createAdminClient()
    .from("social_account_tokens")
    .select("social_account_id, scopes")
    .in("social_account_id", entries.map(([, id]) => id));
  if (error) throw error;
  const scopes = new Map((data ?? []).map((r) => [r.social_account_id, r.scopes]));
  return entries.filter(([sns, id]) => !hasCommentsScope(sns, scopes.get(id) ?? [])).map(([sns]) => sns);
}
