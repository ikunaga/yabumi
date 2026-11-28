import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewCard } from "@/components/auto-post/review-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { SuccessBanner } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { autoRunReviewState, listAutoReviewItems, listExpiredAutoItems } from "@/lib/auto-post/queries";
import { EXPIRED_SEND_WINDOW_MS } from "@/lib/auto-post/remind";
import { getProject } from "@/lib/projects/queries";
import { formatShort } from "@/lib/time";
import { isUuid } from "@/lib/uuid";

export const metadata: Metadata = { title: "確認待ち" };

// 自動の投稿の確かめ待ち（docs/design/auto-post.md の 1.6）。最初の回の確かめ（A3）と、X など「確かめて送る」SNS の承認待ち。
// 入口は、一覧の「確かめ待ち n 件」・概要の帯・カレンダーのチップ・通知（?run= でその回をいちばん上に出す。2026-11-28）。
// 送る時刻を過ぎたものは「時刻を過ぎた投稿」に、過ぎてから 24 時間だけ出し、今すぐ送れる
export default async function AutoReviewPage(props: PageProps<"/projects/[id]/auto/review">) {
  const [{ id }, { run }] = await Promise.all([props.params, props.searchParams]);
  const project = await getProject(id);
  if (!project) notFound();
  const runId = typeof run === "string" && isUuid(run) ? run : null;
  const [waiting, expired] = await Promise.all([listAutoReviewItems(project.id), listExpiredAutoItems(project.id)]);
  // 通知で開いた回を先に
  const first = <T extends { runId: string }>(list: T[]) => (runId ? [...list.filter((i) => i.runId === runId), ...list.filter((i) => i.runId !== runId)] : list);
  const items = first(waiting);
  const late = first(expired);
  // 通知で開いた回が、どちらにもない（もう確認した・送った・送らなかった）
  const opened = runId && !waiting.some((i) => i.runId === runId) && !expired.some((i) => i.runId === runId) ? await autoRunReviewState(runId) : null;
  const base = `/projects/${project.id}/auto`;

  return (
    <div className="flex flex-col gap-5 max-sm:gap-4">
      <Link href={base} className="text-sm text-muted underline">
        ← 自動投稿
      </Link>
      <PageHeader
        title="確認待ち"
        sub={items.length > 0 ? `${items.length} 本` : undefined}
        help={<>送る時刻までに「送る」を押さなければ、その SNS には送らず、下書きに残します（ほかの SNS は予約のまま送ります）。X は、送る前にあなたが中身を確認することを決まりにしています。</>}
      />
      {opened && <OpenedRun projectId={project.id} opened={opened} />}
      {items.length === 0 && late.length === 0 ? (
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
        items.map((item) => <ReviewCard key={`${item.runId}-${item.kind}`} projectId={project.id} item={item} dueLabel={formatShort(item.dueAt)} highlight={item.runId === runId} />)
      )}
      {late.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-bold">送る時刻を過ぎた投稿</h2>
          {late.map((item) => (
            <ReviewCard
              key={`${item.runId}-expired`}
              projectId={project.id}
              item={item}
              dueLabel={formatShort(item.dueAt)}
              deadlineLabel={formatShort(new Date(new Date(item.dueAt).getTime() + EXPIRED_SEND_WINDOW_MS).toISOString())}
              highlight={item.runId === runId}
            />
          ))}
        </section>
      )}
    </div>
  );
}

// 通知のリンクで開いた回が、確認待ち・送る時刻を過ぎた投稿のどちらにもないとき
function OpenedRun({ projectId, opened }: { projectId: string; opened: NonNullable<Awaited<ReturnType<typeof autoRunReviewState>>> }) {
  const due = formatShort(opened.dueAt);
  if (opened.state === "confirmed")
    return <SuccessBanner>{opened.upcoming ? `${due} の投稿は確認済みです。${due} に送ります。` : `${due} の投稿は確認済みです。1 分ほどで送ります。`}</SuccessBanner>;
  if (opened.state === "sent") return <SuccessBanner>{due} の投稿は、もう送りました。</SuccessBanner>;
  return (
    <Card className="flex flex-col gap-1 px-5 py-4 text-[15px] max-sm:px-4">
      <p>{due} の投稿は、ここからは送れません。</p>
      {opened.state === "too_late" ? (
        <p className="text-muted">送る時刻から 24 時間を過ぎました。送るときは、投稿を開いて日時を変えてから予約してください。</p>
      ) : (
        <p className="text-muted">この投稿は、送らないことにしています。</p>
      )}
      {opened.postId && (
        <Link href={`/projects/${projectId}/posts/${opened.postId}`} className="self-start text-sm font-bold underline">
          投稿を開く
        </Link>
      )}
    </Card>
  );
}
