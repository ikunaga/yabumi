import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { postTitle, type PostRow } from "@/lib/posts/queries";
import { SNS } from "@/lib/sns";
import { formatShort } from "@/lib/time";

// 概要の「要確認」: 送れなかった配信先がある投稿。1 件もなければ出さない
export function AttentionCard({ projectId, posts }: { projectId: string; posts: PostRow[] }) {
  if (posts.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <>
            <span className="text-signal">要確認</span>　送れなかった投稿
          </>
        }
      />
      <ul>
        {posts.map((p) => {
          const failed = p.targets.find((t) => t.status === "failed");
          return (
            <li key={p.id} className="border-b border-line last:border-b-0">
              <Link
                href={`/projects/${projectId}/posts/${p.id}`}
                className="flex flex-col gap-1 px-5 py-3 text-[14px] hover:bg-surface2 hover:no-underline max-sm:px-4"
              >
                <span className="flex items-center gap-3">
                  <span className="text-muted">{p.planned_at ? formatShort(p.planned_at) : ""}</span>
                  <span className="truncate">{postTitle(p.body, 30)}</span>
                  <span className="ml-auto text-sm font-bold whitespace-nowrap text-danger">! 失敗</span>
                </span>
                {failed && (
                  <span className="text-sm text-muted">
                    {SNS[failed.sns].label}: {failed.error_message ?? "理由はわかりません"}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
