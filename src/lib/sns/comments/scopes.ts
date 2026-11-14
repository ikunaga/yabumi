import type { SnsKey } from "@/lib/sns";
import { withInsightsScope } from "@/lib/sns/insights/scopes";

// コメントを読む権限（docs/design/sns-comments.md、docs/architecture.md の 4.70）。数字の権限（SNS_INSIGHTS）と同じ作り:
// Meta のアプリでこの権限を足し、SNS_COMMENTS（例: "threads,instagram,facebook"）で有効にしたら、つなぐときに求める
// （Meta のアプリにない権限を求めると、つなぐ画面がエラーになるため、先に Meta の側で足す）
export type CommentsSns = "threads" | "instagram" | "facebook";
export const COMMENTS_SNS: readonly CommentsSns[] = ["threads", "instagram", "facebook"];

// 読むときに確かめる権限（social_account_tokens.scopes にあるか）
export const COMMENTS_SCOPE: Record<CommentsSns, string> = {
  threads: "threads_read_replies",
  instagram: "instagram_business_manage_comments",
  // 他の人のコメントを読むのに pages_read_engagement で足りるかは、Meta の資料で決め切れなかった（2026-11-14）。
  // pages_read_engagement はもとから求めているので、pages_read_user_content も求め、こちらがあることを確かめる
  facebook: "pages_read_user_content",
};

export function isCommentsSns(sns: string): sns is CommentsSns {
  return (COMMENTS_SNS as readonly string[]).includes(sns);
}

export function commentsEnabled(sns: SnsKey, env: string | undefined = process.env.SNS_COMMENTS): boolean {
  return (
    isCommentsSns(sns) &&
    (env ?? "")
      .split(",")
      .map((s) => s.trim())
      .includes(sns)
  );
}

// 有効な SNS と、その権限（due_sns_comment_targets に渡す）
export function enabledCommentScopes(env?: string): Partial<Record<CommentsSns, string>> {
  const out: Partial<Record<CommentsSns, string>> = {};
  for (const sns of COMMENTS_SNS) if (commentsEnabled(sns, env)) out[sns] = COMMENTS_SCOPE[sns];
  return out;
}

export function withCommentsScope<T extends string>(sns: SnsKey, base: readonly T[], env?: string): string[] {
  if (!isCommentsSns(sns) || !commentsEnabled(sns, env)) return [...base];
  const extra = COMMENTS_SCOPE[sns];
  return base.includes(extra as T) ? [...base] : [...base, extra];
}

// つなぐときに求める権限: もとの権限 ＋ 数字の権限（SNS_INSIGHTS）＋ コメントの権限（SNS_COMMENTS）
export function requestedScopes<T extends string>(sns: SnsKey, base: readonly T[], env: { insights?: string; comments?: string } = {}): string[] {
  return withCommentsScope(sns, withInsightsScope(sns, base, env.insights), env.comments);
}

export function hasCommentsScope(sns: SnsKey, scopes: readonly string[]): boolean {
  return isCommentsSns(sns) && scopes.includes(COMMENTS_SCOPE[sns]);
}
