import "server-only";
import { cache } from "react";
import { SNS_KEYS, isSnsKey, type SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";
import { isUnsentDraft } from "./drafts";
import { dueManualPostIds, overduePostIds } from "./overdue";
import { NOT_X_BY_HAND_FILTER } from "@/lib/sns/x/send-rules";

export type TargetStatus = "pending" | "preparing" | "publishing" | "published" | "failed" | "deleted";
export type PostTargetRow = {
  id: string;
  sns: SnsKey;
  status: TargetStatus;
  body_override: string | null;
  title: string | null;
  external_post_id: string | null;
  external_url: string | null;
  sns_removed_at: string | null;
  error_message: string | null;
  published_at: string | null;
  next_attempt_at: string | null;
  // 引用する X の投稿の id（引用の X の配信先だけ。利用者が X の画面で送り、記録したら消える。4.52）
  quote_post_id: string | null;
  // 本文とは別に付けるタグ（# なし。送るときに本文の後ろに足す。4.59）
  hashtags: string[];
};
export type PostRow = {
  id: string;
  body: string;
  planned_at: string | null;
  status: "draft" | "scheduled";
  targets: PostTargetRow[];
  // 添えた画像の枚数（カレンダーの注意「Instagram は画像が未設定です」に使う）
  images: number;
  // 本文を書いたのは誰か（null は列を足す前からある投稿。docs/design/voice-from-posts.md の 2.3）
  textOrigin: "self" | "ai" | null;
  // 投稿をつくったときに選んでいたフォーマットと、つないだロードマップのやること（下書きから再開したときに戻す。PMO2 の s8）
  formatId: string | null;
  roadmapItemId: string | null;
};

const TARGET_FIELDS = "id, sns, status, title, body_override, external_post_id, external_url, sns_removed_at, error_message, published_at, next_attempt_at, quote_post_id, hashtags";
const POST_SELECT = `id, body, planned_at, status, text_origin, format_id, roadmap_item_id, post_targets(${TARGET_FIELDS}), media_files(count)` as const;
const POST_SELECT_FAILED_ONLY = `id, body, planned_at, status, text_origin, format_id, roadmap_item_id, post_targets!inner(${TARGET_FIELDS}), media_files(count)` as const;


type RawPost = {
  id: string;
  body: string;
  planned_at: string | null;
  status: string;
  text_origin?: string | null;
  format_id?: string | null;
  roadmap_item_id?: string | null;
  post_targets: (Omit<PostTargetRow, "sns" | "status"> & { sns: string; status: string })[];
  media_files?: { count: number }[];
};

function normalize(p: RawPost): PostRow {
  return {
    id: p.id,
    body: p.body,
    planned_at: p.planned_at,
    status: p.status === "scheduled" ? "scheduled" : "draft",
    textOrigin: p.text_origin === "ai" || p.text_origin === "self" ? p.text_origin : null,
    formatId: p.format_id ?? null,
    roadmapItemId: p.roadmap_item_id ?? null,
    targets: p.post_targets
      .filter((t) => isSnsKey(t.sns))
      .map((t) => ({ ...t, sns: t.sns as SnsKey, status: t.status as TargetStatus }))
      .sort((a, b) => SNS_KEYS.indexOf(a.sns) - SNS_KEYS.indexOf(b.sns)),
    images: p.media_files?.[0]?.count ?? 0,
  };
}

// どれも RLS により、ログイン中のユーザー自身の投稿しか返らない

export const getPost = cache(async (projectId: string, postId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("posts").select(POST_SELECT).eq("project_id", projectId).eq("id", postId).maybeSingle();
  if (error) throw error;
  return data ? normalize(data as RawPost) : null;
});

// limit: 月の表示（6 週分）では読む行に上限を付ける。数は countPostsByDay で DB で数えるので、読みきれなくても数え漏れない
export async function listPostsBetween(projectId: string, fromIso: string, toIso: string, limit?: number) {
  const supabase = await createClient();
  let query = supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("project_id", projectId)
    .gte("planned_at", fromIso)
    .lt("planned_at", toIso)
    .order("planned_at");
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data as RawPost[]).map(normalize);
}

// 日ごとの投稿の数（日本時間の "YYYY-MM-DD" → 数）。行を読んで数えずに DB で数える（calendar_day_counts）
export async function countPostsByDay(projectId: string, fromIso: string, toIso: string): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("calendar_day_counts", { p_project_id: projectId, p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.day, r.posts]));
}

export async function listUndatedDrafts(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("project_id", projectId)
    .is("planned_at", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data as RawPost[]).map(normalize);
}

// 下書きの一覧（まだどこにも送っていない下書き。直した日の新しい順。src/lib/posts/drafts.ts の決め方）
export const DRAFTS_LIMIT = 200;
export type DraftRow = { id: string; body: string; plannedAt: string | null; updatedAt: string; sns: SnsKey[]; overrides: (string | null)[]; titles: (string | null)[]; images: number };
export async function listDrafts(projectId: string): Promise<DraftRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select("id, body, planned_at, updated_at, status, post_targets(sns, status, title, body_override), media_files(count)")
    .eq("project_id", projectId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(DRAFTS_LIMIT);
  if (error) throw error;
  return (data ?? [])
    .filter((p) => isUnsentDraft({ status: p.status, targetStatuses: p.post_targets.map((t) => t.status) }))
    .map((p) => ({
      id: p.id,
      body: p.body,
      plannedAt: p.planned_at,
      updatedAt: p.updated_at,
      sns: p.post_targets.map((t) => t.sns).filter(isSnsKey).sort((a, b) => SNS_KEYS.indexOf(a) - SNS_KEYS.indexOf(b)),
      overrides: p.post_targets.map((t) => t.body_override),
      titles: p.post_targets.map((t) => t.title),
      images: (p.media_files as { count: number }[] | null)?.[0]?.count ?? 0,
    }));
}

export async function listUpcomingPosts(projectId: string, limit = 5) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("project_id", projectId)
    .gte("planned_at", new Date().toISOString())
    .order("planned_at")
    .limit(limit);
  if (error) throw error;
  return (data as RawPost[]).map(normalize);
}

// プロジェクトにつないだ、使える SNS アカウント（SNS ごとに 1 つ目を使う）
export async function connectedAccounts(projectId: string): Promise<Partial<Record<SnsKey, string>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_social_accounts")
    .select("social_account_id, social_accounts(sns, status)")
    .eq("project_id", projectId);
  if (error) throw error;
  const result: Partial<Record<SnsKey, string>> = {};
  for (const row of data as unknown as { social_account_id: string; social_accounts: { sns: string; status: string } | null }[]) {
    const a = row.social_accounts;
    if (a && a.status === "active" && isSnsKey(a.sns) && !result[a.sns]) result[a.sns] = row.social_account_id;
  }
  return result;
}

// つないだアカウントの表示名と @handle（投稿をつくるの見え方に出す。本人のアカウントだけ。RLS が本人の行に絞る）。
// 2026-11-12 PMO の通しのテスト「Instagram の見え方の名前がプロジェクトの名前で、実際は scene_and_sound_jp だった」
export type AccountNames = Partial<Record<SnsKey, { name: string; handle: string }>>;
export async function connectedAccountNames(projectId: string): Promise<AccountNames> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_social_accounts")
    .select("social_accounts(sns, status, display_name, handle)")
    .eq("project_id", projectId);
  if (error) throw error;
  const result: AccountNames = {};
  for (const row of data as unknown as { social_accounts: { sns: string; status: string; display_name: string; handle: string } | null }[]) {
    const a = row.social_accounts;
    if (a && a.status === "active" && isSnsKey(a.sns) && !result[a.sns]) result[a.sns] = { name: a.display_name, handle: a.handle };
  }
  return result;
}

// 送れなかった配信先がある投稿（概要の「要確認」）
export async function listPostsNeedingAttention(projectId: string, limit = 5) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    // !inner で、失敗した配信先がある投稿だけを、失敗した配信先だけ付けて返す
    .select(POST_SELECT_FAILED_ONLY)
    .eq("project_id", projectId)
    .eq("post_targets.status", "failed")
    // 「X は手で投稿する」を選んだ X は、送れなかったものに数えない
    .or(NOT_X_BY_HAND_FILTER, { referencedTable: "post_targets" })
    .order("planned_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as unknown as RawPost[]).map(normalize);
}

// 予約時刻を過ぎても送られていない投稿（送信ジョブが止まっている印。概要の「要確認」）
export async function listOverduePosts(projectId: string, now = new Date()) {
  const supabase = await createClient();
  const ids = await overduePostIds(supabase, projectId, now);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("posts").select(POST_SELECT).in("id", ids).order("planned_at");
  if (error) throw error;
  return (data as RawPost[]).map(normalize);
}

// 手で投稿する予定の時刻が来た投稿（概要の「手で投稿する番です」）
export async function listDueManualPosts(projectId: string, now = new Date()) {
  const supabase = await createClient();
  const ids = await dueManualPostIds(supabase, projectId, now);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("posts").select(POST_SELECT).in("id", ids).order("planned_at");
  if (error) throw error;
  return (data as RawPost[]).map(normalize);
}

// 一覧やカレンダーに出す見出し（本文の 1 行目）
export function postTitle(body: string, max = 24): string {
  const first = body.trim().split("\n")[0] ?? "";
  if (!first) return "（本文なし）";
  return [...first].length > max ? `${[...first].slice(0, max).join("")}…` : first;
}
