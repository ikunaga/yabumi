// 今すぐ送る（4.36）で、sendSavedPost が送ってよい投稿か。savePost が「いま送る予約」として保存した投稿だけ。
// 先の日時の予約を、ここから早めて送れないようにする（保存してから送り始めるまでの遅れは、余裕を持って 10 分まで見る）
export const NOW_WINDOW_MS = 10 * 60 * 1000;

export function isSendNowPost(post: { status: string; planned_at: string | null }, now: Date): boolean {
  if (post.status !== "scheduled" || !post.planned_at) return false;
  return new Date(post.planned_at).getTime() <= now.getTime() + NOW_WINDOW_MS;
}
