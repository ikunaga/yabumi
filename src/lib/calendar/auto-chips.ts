import type { UpcomingAutoRun } from "@/lib/auto-post/types";
import type { PostRow } from "@/lib/posts/queries";
import type { SnsKey } from "@/lib/sns";

// カレンダーに出す自動の回（docs/design/auto-post.md の 1.6）。
// 作る前の回は点線の札「↻ 自動（作る前） 回し方の名前」で、押すと回し方の画面へ。作ったあとの回はふつうの投稿の札に「↻」を付ける。
// 確かめ待ち（最初の回の確かめ・確かめて送る SNS の承認待ち）は、押すと確かめ待ちの画面へ（予約には数えない。displayStatus と同じ扱い）

export type PlannedAutoChip = { id: string; planId: string; dueAt: string; href: string; title: string; sns: SnsKey[] };

export const PLANNED_TITLE = "自動（作る前）";

// 作る前の回（投稿がまだないもの）。作ったあとの回は投稿として出るので、ここには入れない
export function plannedAutoChips(runs: UpcomingAutoRun[], base: string): PlannedAutoChip[] {
  return runs
    .filter((r) => r.postId === null && (r.status === "waiting" || r.status === "generating"))
    .map((r) => ({
      id: r.runId || `${r.planId}|${r.dueAt}`,
      planId: r.planId,
      dueAt: r.dueAt,
      href: `${base}/auto/${r.planId}`,
      title: `${PLANNED_TITLE} ${r.planName}`,
      sns: r.sns,
    }));
}

// 最初の回の確かめ待ち（A3）の投稿。投稿は下書きのまま、回の状態だけが review
export function firstReviewPostIds(runs: UpcomingAutoRun[]): Set<string> {
  return new Set(runs.filter((r) => r.status === "review" && r.postId).map((r) => r.postId!));
}

// 自動の回の投稿が確かめ待ちか（最初の回の確かめ、または確かめて送る SNS の承認待ちがある）
export function isAutoAwaitingReview(post: PostRow, firstReview: Set<string>): boolean {
  if (!post.autoRunId) return false;
  return firstReview.has(post.id) || post.targets.some((t) => t.status === "awaiting_approval");
}

// 投稿の札の行き先: 確かめ待ちなら確かめ待ちの画面、ほかは投稿の画面
export function postChipHref(post: PostRow, base: string, firstReview: Set<string>): string {
  return isAutoAwaitingReview(post, firstReview) ? `${base}/auto/review` : `${base}/posts/${post.id}`;
}

// 最初の回の確かめ待ちの注意（送り先の確かめ待ちは postWarning が出す）
export function autoReviewWarning(post: PostRow, firstReview: Set<string>): string | null {
  return post.autoRunId && firstReview.has(post.id) ? "最初の回の確かめ待ちです" : null;
}

// カレンダーで読む自動の回の範囲。過ぎた時刻の回は出さない（作る前のまま過ぎた回を、規則から作り出さないため）
export function autoRunsRange(fromIso: string, toIso: string, now: Date = new Date()): { from: Date; until: Date } | null {
  const from = new Date(Math.max(new Date(fromIso).getTime(), now.getTime()));
  const until = new Date(toIso);
  return from < until ? { from, until } : null;
}
