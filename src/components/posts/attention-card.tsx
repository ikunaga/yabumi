import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { postTitle, type PostRow } from "@/lib/posts/queries";
import { SNS } from "@/lib/sns";
import { formatShort } from "@/lib/time";

// 概要の「要確認」: 送れなかった配信先がある投稿と、予約時刻を過ぎても送られていない投稿。1 件もなければ出さない
export function AttentionCard({ projectId, posts, overdue = [] }: { projectId: string; posts: PostRow[]; overdue?: PostRow[] }) {
  if (posts.length === 0 && overdue.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={
          <>
            <span className="text-signal">要確認</span>　送れなかった投稿
          </>
        }
      />
      {overdue.length > 0 && (
        <div className="border-b border-line bg-signal-soft px-5 py-3 text-sm leading-[1.7] max-sm:px-4">
          <p className="font-bold">予約時刻を過ぎても送られていない投稿があります（{overdue.length} 件）</p>
          <p className="text-muted">
            送信のしくみ（毎分の予約ジョブ）が止まっている可能性があります。本番では Vercel と Supabase の状態を、ローカルでは「pnpm jobs:bridge」が動いているかを確かめてください（docs/deploy.md の「困ったとき」）。動き出せば、自動で送られます。
          </p>
          <ul className="mt-1">
            {overdue.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${projectId}/posts/${p.id}`} className="font-semibold text-primary hover:underline">
                  {p.planned_at ? formatShort(p.planned_at) : ""} {postTitle(p.body, 24)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
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
