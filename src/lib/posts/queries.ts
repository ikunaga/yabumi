import "server-only";
import { cache } from "react";
import { SNS_KEYS, isSnsKey, type SnsKey } from "@/lib/sns";
import { createClient } from "@/lib/supabase/server";
import { overduePostIds } from "./overdue";

export type TargetStatus = "pending" | "publishing" | "published" | "failed" | "deleted";
export type PostTargetRow = {
  id: string;
  sns: SnsKey;
  status: TargetStatus;
  body_override: string | null;
  external_url: string | null;
  error_message: string | null;
  published_at: string | null;
  next_attempt_at: string | null;
};
export type PostRow = {
  id: string;
  body: string;
  planned_at: string | null;
  status: "draft" | "scheduled";
  targets: PostTargetRow[];
};

const TARGET_FIELDS = "id, sns, status, body_override, external_url, error_message, published_at, next_attempt_at";
const POST_SELECT = `id, body, planned_at, status, post_targets(${TARGET_FIELDS})` as const;
const POST_SELECT_FAILED_ONLY = `id, body, planned_at, status, post_targets!inner(${TARGET_FIELDS})` as const;


type RawPost = {
  id: string;
  body: string;
  planned_at: string | null;
  status: string;
  post_targets: (Omit<PostTargetRow, "sns" | "status"> & { sns: string; status: string })[];
};

function normalize(p: RawPost): PostRow {
  return {
    id: p.id,
    body: p.body,
    planned_at: p.planned_at,
    status: p.status === "scheduled" ? "scheduled" : "draft",
    targets: p.post_targets
      .filter((t) => isSnsKey(t.sns))
      .map((t) => ({ ...t, sns: t.sns as SnsKey, status: t.status as TargetStatus }))
      .sort((a, b) => SNS_KEYS.indexOf(a.sns) - SNS_KEYS.indexOf(b.sns)),
  };
}

// どれも RLS により、ログイン中のユーザー自身の投稿しか返らない

export const getPost = cache(async (projectId: string, postId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("posts").select(POST_SELECT).eq("project_id", projectId).eq("id", postId).maybeSingle();
  if (error) throw error;
  return data ? normalize(data as RawPost) : null;
});

export async function listPostsBetween(projectId: string, fromIso: string, toIso: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("project_id", projectId)
    .gte("planned_at", fromIso)
    .lt("planned_at", toIso)
    .order("planned_at");
  if (error) throw error;
  return (data as RawPost[]).map(normalize);
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

// 送れなかった配信先がある投稿（概要の「要確認」）
export async function listPostsNeedingAttention(projectId: string, limit = 5) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    // !inner で、失敗した配信先がある投稿だけを、失敗した配信先だけ付けて返す
    .select(POST_SELECT_FAILED_ONLY)
    .eq("project_id", projectId)
    .eq("post_targets.status", "failed")
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

// 一覧やカレンダーに出す見出し（本文の 1 行目）
export function postTitle(body: string, max = 24): string {
  const first = body.trim().split("\n")[0] ?? "";
  if (!first) return "（本文なし）";
  return [...first].length > max ? `${[...first].slice(0, max).join("")}…` : first;
}
