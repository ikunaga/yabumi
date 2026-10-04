import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { postTitle, type PostRow } from "@/lib/posts/queries";
import { isManualSns, SNS } from "@/lib/sns";
import { formatShort } from "@/lib/time";

// 概要の「手で投稿する番です」: note・Substack に投稿する予定の時刻が来た投稿。1 件もなければ出さない
export function ManualDueCard({ projectId, posts }: { projectId: string; posts: PostRow[] }) {
  if (posts.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader title="手で投稿する番です" />
      <p className="border-b border-line bg-primary-soft px-5 py-2.5 text-sm leading-[1.7] max-sm:px-4">
        note・Substack は自動では送られません。投稿の画面で本文をコピーして投稿し、「投稿した」を押してください。
      </p>
      <ul>
        {posts.map((p) => {
          const manual = p.targets.filter((t) => isManualSns(t.sns) && t.status === "pending").map((t) => SNS[t.sns].label);
          return (
            <li key={p.id} className="border-b border-line last:border-b-0">
              <Link
                href={`/projects/${projectId}/posts/${p.id}`}
                className="grid grid-cols-[90px_1fr_auto] items-center gap-3 px-5 py-3 text-[14px] hover:bg-surface2 hover:no-underline max-sm:px-4"
              >
                <span className="text-muted">{p.planned_at ? formatShort(p.planned_at) : ""}</span>
                <span className="truncate">{postTitle(p.body, 30)}</span>
                <span className="text-sm whitespace-nowrap text-muted">{manual.join("・")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
