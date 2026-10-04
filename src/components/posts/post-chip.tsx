import Link from "next/link";
import type { PostRow } from "@/lib/posts/queries";
import { postTitle } from "@/lib/posts/queries";
import { SNS, checkTarget } from "@/lib/sns";
import { formatTime } from "@/lib/time";

export type PostDisplayStatus = "draft" | "scheduled" | "posted" | "failed";

export function displayStatus(post: PostRow): PostDisplayStatus {
  if (post.targets.some((t) => t.status === "failed")) return "failed";
  // SNS 上で取り消したものは数えない
  const live = post.targets.filter((t) => t.status !== "deleted");
  if (live.length > 0 && live.every((t) => t.status === "published")) return "posted";
  if (post.targets.length > 0 && live.length === 0) return "draft";
  return post.status === "scheduled" ? "scheduled" : "draft";
}

// "X ・ Threads"。3 つ以上は "4 つの SNS"
export function snsSummary(post: PostRow, short = false): string {
  if (post.targets.length === 0) return "送り先なし";
  if (post.targets.length >= 3 && !short) return `${post.targets.length} つの SNS`;
  return post.targets.map((t) => (short && t.sns === "instagram" ? "IG" : short && t.sns === "facebook" ? "FB" : SNS[t.sns].label)).join(short ? " / " : " ・ ");
}

// 予約・下書きの注意（例: Instagram は画像が未設定です）
export function postWarning(post: PostRow): string | null {
  for (const t of post.targets) {
    const issue = checkTarget(t.sns, t.body_override ?? post.body).issues[0];
    if (issue === "needs_image") return `${SNS[t.sns].label} は画像が未設定です`;
    if (issue === "needs_video") return `${SNS[t.sns].label} は動画が未設定です`;
    if (issue === "too_long") return `${SNS[t.sns].label} は文字数オーバーです`;
  }
  return null;
}

const chipStyle: Record<PostDisplayStatus, string> = {
  scheduled: "border-l-[3px] border-signal bg-signal-soft",
  posted: "border-l-[3px] border-success bg-success-soft",
  failed: "border-l-[3px] border-danger bg-danger-soft",
  draft: "border border-dashed border-border text-muted",
};

// カレンダー（PC）のチップ
export function PostChip({ post, projectId }: { post: PostRow; projectId: string }) {
  const status = displayStatus(post);
  return (
    <Link
      href={`/projects/${projectId}/posts/${post.id}`}
      className={`flex flex-col gap-[3px] rounded-sm px-2.5 py-2 text-xs leading-normal hover:no-underline hover:brightness-[0.97] ${chipStyle[status]}`}
    >
      <b>
        {status === "draft" ? "下書き" : ""}
        {post.planned_at ? ` ${formatTime(post.planned_at)}` : ""}
        {status === "draft" ? "" : ` ${snsSummary(post)}`}
      </b>
      <span>{postTitle(post.body, 14)}</span>
      {status === "failed" && <span className="font-bold text-danger">! 失敗あり</span>}
    </Link>
  );
}
