// 概要の「● 要確認」の帯で閉じた項目（docs/architecture.md の 4.71）。
// 送れなかった投稿は post_targets.attention_closed_at（failed に変わるたびに空になる）、
// ほかの 3 種類は attention_dismissals（項目と、閉じたときの予定日時の組。予定を動かすとまた出る）
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PostRow } from "@/lib/posts/queries";
import type { RoadmapItem } from "@/lib/roadmap/load";

// close_attention に渡す 1 件（画面に出していた項目）。stamp は出していたときの予定時刻・予定日
export type AttentionItem =
  | { kind: "failed"; id: string }
  | { kind: "overdue" | "manual"; id: string; stamp: string }
  | { kind: "todo"; id: string; stamp: string };

// close_attention が受け付ける件数の上限（DB の関数と同じ）
export const MAX_ATTENTION_ITEMS = 200;

export type AttentionDismissals = {
  posts: Set<string>;
  todos: Set<string>;
};

const postKey = (kind: "overdue" | "manual", postId: string, at: string) => `${kind}:${postId}:${new Date(at).getTime()}`;
const todoKey = (itemId: string, on: string) => `${itemId}:${on}`;

export async function loadAttentionDismissals(supabase: SupabaseClient<Database>, projectId: string): Promise<AttentionDismissals> {
  const { data, error } = await supabase
    .from("attention_dismissals")
    .select("kind, post_id, roadmap_item_id, ref_at, ref_on")
    .eq("project_id", projectId)
    .limit(1000);
  if (error) throw error;
  const result: AttentionDismissals = { posts: new Set(), todos: new Set() };
  for (const r of data ?? []) {
    if ((r.kind === "overdue" || r.kind === "manual") && r.post_id && r.ref_at) result.posts.add(postKey(r.kind, r.post_id, r.ref_at));
    else if (r.kind === "todo" && r.roadmap_item_id && r.ref_on) result.todos.add(todoKey(r.roadmap_item_id, r.ref_on));
  }
  return result;
}

export function isPostDismissed(d: AttentionDismissals, kind: "overdue" | "manual", post: { id: string; planned_at: string | null }): boolean {
  return post.planned_at !== null && d.posts.has(postKey(kind, post.id, post.planned_at));
}

export function isTodoDismissed(d: AttentionDismissals, item: { id: string; plannedOn: string | null }): boolean {
  return item.plannedOn !== null && d.todos.has(todoKey(item.id, item.plannedOn));
}

// 帯に出している項目（× で閉じるときに渡す）。送れなかった投稿は、帯に出している失敗の配信先を全部
export function attentionItems({
  failed,
  overdue,
  manualDue,
  overdueTodos,
}: {
  failed: PostRow[];
  overdue: PostRow[];
  manualDue: PostRow[];
  overdueTodos: RoadmapItem[];
}): AttentionItem[] {
  const items: AttentionItem[] = [
    ...failed.flatMap((p) => p.targets.filter((t) => t.status === "failed").map((t) => ({ kind: "failed" as const, id: t.id }))),
    ...overdue.flatMap((p) => (p.planned_at ? [{ kind: "overdue" as const, id: p.id, stamp: p.planned_at }] : [])),
    ...manualDue.flatMap((p) => (p.planned_at ? [{ kind: "manual" as const, id: p.id, stamp: p.planned_at }] : [])),
    ...overdueTodos.flatMap((i) => (i.plannedOn ? [{ kind: "todo" as const, id: i.id, stamp: i.plannedOn }] : [])),
  ];
  return items.slice(0, MAX_ATTENTION_ITEMS);
}
