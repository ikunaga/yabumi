import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentsReconnectNotice, PostCommentsCard } from "@/components/comments/comments";
import { MarkCommentsSeen } from "@/components/comments/mark-seen";
import { Card, EmptyState } from "@/components/ui/card";
import { chipClass } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-header";
import { connectedAccounts } from "@/lib/posts/queries";
import { getProject } from "@/lib/projects/queries";
import { SNS, type SnsKey } from "@/lib/sns";
import { loadProjectComments, snsNeedingCommentsReconnect } from "@/lib/sns/comments/queries";

export const metadata: Metadata = { title: "コメント" };

const FILTERS: SnsKey[] = ["threads", "instagram", "facebook", "x"];

// SNS のコメント（docs/design/sns-comments.md の 6、docs/architecture.md の 4.70）。
// Threads・Instagram・Facebook に送った投稿のコメントを投稿ごとに並べる。X は返信の数だけ。返信は SNS の画面で行う。
// 入口は、概要の「新しいコメント」の帯・スマホの通知・投稿の画面・More
export default async function CommentsPage(props: PageProps<"/projects/[id]/comments">) {
  const [{ id }, { sns }] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const [posts, accounts] = await Promise.all([loadProjectComments(project.id), connectedAccounts(project.id)]);
  const reconnect = await snsNeedingCommentsReconnect(accounts);
  const filter = FILTERS.find((s) => s === sns) ?? null;
  const shown = filter ? posts.filter((p) => p.sns === filter) : posts;
  const newCount = posts.reduce((n, p) => n + p.newCount, 0);
  const present = FILTERS.filter((s) => posts.some((p) => p.sns === s));
  const base = `/projects/${project.id}/comments`;
  const now = new Date();

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <MarkCommentsSeen projectId={project.id} />
      <PageHeader
        title="コメント"
        sub={`直近 30 日${newCount > 0 ? `・新しい ${newCount} 件` : ""}`}
        help={
          <>
            Threads・Instagram・Facebook に yabumi から送った投稿のコメントを、送ってから 7 日まで、3 時間ごとに読みます。返信は「SNS で開いて返信する」から SNS の画面で行います。コメントは 30 日で消し、AI には送りません。X は返信の数だけを出します（毎日の数字の取り込みの数）。
          </>
        }
      />
      <CommentsReconnectNotice projectId={project.id} sns={reconnect} />
      {present.length > 1 && (
        <nav aria-label="SNS で絞り込む" className="flex flex-wrap gap-2">
          <Link href={base} className={chipClass({ on: !filter })} aria-current={!filter ? "page" : undefined}>
            すべて
          </Link>
          {present.map((s) => (
            <Link key={s} href={`${base}?sns=${s}`} className={chipClass({ on: filter === s })} aria-current={filter === s ? "page" : undefined}>
              {SNS[s].label}
            </Link>
          ))}
        </nav>
      )}
      {shown.length === 0 ? (
        <Card>
          <EmptyState title="まだコメントはありません" description="送ってから 7 日までの投稿のコメントを、3 時間ごとに読んで、ここに並べます。" />
        </Card>
      ) : (
        shown.map((p) => <PostCommentsCard key={p.targetId} projectId={project.id} p={p} now={now} />)
      )}
    </div>
  );
}
