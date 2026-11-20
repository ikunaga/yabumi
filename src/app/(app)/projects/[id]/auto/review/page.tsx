import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewCard } from "@/components/auto-post/review-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listAutoReviewItems } from "@/lib/auto-post/queries";
import { getProject } from "@/lib/projects/queries";
import { formatShort } from "@/lib/time";

export const metadata: Metadata = { title: "確認待ち" };

// 自動の投稿の確かめ待ち（docs/design/auto-post.md の 1.6）。最初の回の確かめ（A3）と、X など「確かめて送る」SNS の承認待ち。
// 入口は、一覧の「確かめ待ち n 件」・概要の帯・カレンダーのチップ・通知。送る時刻を過ぎたものは出さない（queries）
export default async function AutoReviewPage(props: PageProps<"/projects/[id]/auto/review">) {
  const { id } = await props.params;
  const project = await getProject(id);
  if (!project) notFound();
  const items = await listAutoReviewItems(project.id);
  const base = `/projects/${project.id}/auto`;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <Link href={base} className="text-sm text-muted underline">
        ← 自動投稿
      </Link>
      <PageHeader
        title="確認待ち"
        sub={items.length > 0 ? `${items.length} 件` : undefined}
        help={<>送る時刻までに「送る」を押さなければ、その SNS には送らず、下書きに残します（ほかの SNS は予約のまま送ります）。X は、送る前にあなたが中身を確認することを決まりにしています。</>}
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="確認待ちはありません"
            description="X などに送る文ができたら、通知でお知らせします。"
            action={
              <ButtonLink href={base} variant="secondary">
                自動投稿へ
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        items.map((item) => <ReviewCard key={`${item.runId}-${item.kind}`} projectId={project.id} item={item} dueLabel={formatShort(item.dueAt)} />)
      )}
    </div>
  );
}
